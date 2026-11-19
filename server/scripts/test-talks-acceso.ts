// Pruebas de «Abrir en Talks» sin volver a pedir el correo (el Hub le pide a Talks un pase de un solo uso para quien ya inició sesión en el Hub), sin tocar nada real:
// una base en memoria (PGlite) con el esquema real y un Talks de mentira (servidor HTTP local que imita la ruta POST /api/v1/acceso-equipo del contrato, con sus códigos).
// Cualquier llamada a otra dirección hace fallar la prueba, así que no hay forma de que llegue al Talks de verdad. Llaves, correos y datos inventados.
// Revisa: que el correo que sale hacia Talks sea SIEMPRE el de la sesión del Hub (uno mandado en la petición se ignora), que cada llamada pida un pase nuevo,
// que cada fallo (404, 401, 400, un 403, Talks caído o sin responder, una dirección que no es de Talks) responda con su motivo y nunca con un error de
// pantalla, que quién entra lo decida el Hub (Talks ya no tiene otra lista para quien llega con el pase: cualquier persona con sesión del Hub recibe el suyo), que
// el pase no quede en los registros ni en la base, y la lógica de la pantalla (la ventana se abre primero, el pase se pone ahí; si algo falla se abre el link normal
// en esa misma ventana con su aviso; nunca se queda atascado).
// uso: node server/node_modules/.bin/tsx server/scripts/test-talks-acceso.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getTalksAccessLink from '../../src/api/getTalksAccessLink';
import { ESPERA_ACCESO_MS, pedirAccesoEquipoTalks } from '../talks/client';
import {
  AVISO_LINK_NO_VALIDO, AVISO_SIN_ENTRADA_DIRECTA, AVISO_VENTANA_BLOQUEADA, ESPERA_ACCESO_PANTALLA_MS,
  abrirEnTalks, esDireccionWeb, type ResultadoAcceso, type VentanaTalks,
} from '../../src/lib/talksAbrir';

// ─── Registros: todo lo que los endpoints escriben en consola se guarda aparte, para revisar al final que no se filtró el pase ni la llave ───
const registros: string[] = [];
const conBitacora = async <T>(f: () => Promise<T>): Promise<T> => {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const guardar = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 4 }))).join(' ')); };
  console.log = guardar; console.warn = guardar; console.error = guardar;
  try { return await f(); } finally { Object.assign(console, original); }
};

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}
async function falla(f: () => Promise<unknown>): Promise<any> {
  try { await f(); } catch (e) { return e; }
  return assert.fail('debía fallar y no falló');
}

// ─── Base en memoria con el esquema real ───
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
// observation_sessions no sale del esquema generado (la crea add-observation-room-tables.ts y las columnas de Talks las agrega add-observation-talks-columns.ts).
await pg.exec(`
  create table observation_sessions (
    id uuid primary key default gen_random_uuid(),
    calendar_event_id uuid references calendar_events(id) on delete set null,
    slug text unique not null,
    nombre text, cliente text,
    talks_session_id text, talks_link_equipo text, talks_link_participantes text,
    created_at timestamptz not null default now()
  )`);
await pg.query(`insert into projects (project_code, status, client) values ('P-UNO', 'En curso', 'Cliente de Prueba')`);
const evento = async (nombre: string) =>
  (await pg.query<{ id: string }>(`insert into calendar_events (event_name, project_code, calendar_name) values ($1, 'P-UNO', 'Cal') returning id`, [nombre])).rows[0].id;
const sala = (eventoId: string, slug: string, talks?: { id: string; equipo: string; participantes: string }) =>
  pg.query(
    `insert into observation_sessions (calendar_event_id, slug, nombre, talks_session_id, talks_link_equipo, talks_link_participantes) values ($1, $2, 'Sala', $3, $4, $5)`,
    [eventoId, slug, talks?.id ?? null, talks?.equipo ?? null, talks?.participantes ?? null],
  );

// ─── Talks de mentira: imita POST /api/v1/acceso-equipo con los mismos códigos del contrato ───
const LLAVE_DEL_HUB = 'llave-del-hub-de-mentira-9f3a';
// Talks ya NO compara el correo con ninguna lista (EQUIPO_PERMITIDO) para quien llega con el pase: quién entra lo decide el Hub.
const SESIONES_CONOCIDAS = new Set(['s1abc', 's2abc']);
const llamadasTalks: Array<{ metodo: string; url: string; auth?: string; cuerpo?: any }> = [];
let talksModo: 'normal' | 'caido' | 'redireccion' | 'datos-malos' | 'prohibido' | 'url-ajena' | 'url-rara' | 'sin-url' | 'url-de-los-links' | 'lento' = 'normal';
let pases = 0;
const conexiones = new Set<import('node:net').Socket>();
// Las respuestas que el Talks «lento» deja colgadas: al terminar esa prueba se cierran SOLO ésas (cerrar todas las conexiones dejaría una vieja en uso y
// la siguiente petición fallaría por esa razón, no por lo que se está probando).
const colgadas: http.ServerResponse[] = [];

const servidorTalks = http.createServer(async (req, res) => {
  const trozos: Buffer[] = [];
  for await (const t of req) trozos.push(t as Buffer);
  const crudo = Buffer.concat(trozos).toString('utf8');
  let cuerpo: any;
  try { cuerpo = crudo ? JSON.parse(crudo) : undefined; } catch { cuerpo = undefined; }
  llamadasTalks.push({ metodo: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, cuerpo });
  const json = (status: number, obj: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (talksModo === 'lento') { colgadas.push(res); return; } // nunca contesta
  if (talksModo === 'caido') return json(503, { error: 'en mantenimiento' });
  if (talksModo === 'redireccion') { res.writeHead(302, { Location: 'https://otro.ejemplo.test/' }); return res.end(); }
  if (req.headers.authorization !== `Bearer ${LLAVE_DEL_HUB}`) return json(401, { error: 'llave inválida' });
  if (req.method !== 'POST' || req.url !== '/api/v1/acceso-equipo') return json(404, { error: 'ruta desconocida' });
  if (talksModo === 'prohibido') return json(403, { error: 'SIN_ACCESO' }); // un 403 que el contrato ya no da (era el de la lista del equipo): no debe tratarse distinto

  const b = cuerpo ?? {};
  if (talksModo === 'datos-malos' || typeof b.email !== 'string' || !b.email.includes('@')) return json(400, { error: 'datos mal formados' });
  if (b.nombre !== undefined && (typeof b.nombre !== 'string' || b.nombre.length > 60)) return json(400, { error: 'nombre inválido' });
  if (b.sesionId !== undefined && !SESIONES_CONOCIDAS.has(b.sesionId)) return json(404, { error: 'SESION_NO_ENCONTRADA' });

  pases++;
  const marca = `PASE-${pases}-SECRETO`;
  const base = talksModo === 'url-de-los-links' ? 'https://talks.ejemplo.test' : TALKS_BASE;
  const url =
    talksModo === 'url-ajena' ? `https://sitio-malo.ejemplo.test/entrar-hub#c=${marca}`
    : talksModo === 'url-rara' ? 'javascript:alert(1)'
    : `${base}/entrar-hub#c=${marca}`;
  if (talksModo === 'sin-url') return json(201, { venceEnSegundos: 60 });
  return json(201, { url, venceEnSegundos: 60 });
});
servidorTalks.on('connection', (s) => { conexiones.add(s); s.on('close', () => conexiones.delete(s)); });
await new Promise<void>((ok) => servidorTalks.listen(0, '127.0.0.1', ok));
const TALKS_BASE = `http://127.0.0.1:${(servidorTalks.address() as AddressInfo).port}`;
const puertoCerrado = await new Promise<number>((ok) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); });
});

// ─── fetch: solo el Talks local; cualquier otra cosa hace fallar la prueba ───
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('http://127.0.0.1:')) return fetchReal(input, init);
  throw new Error(`La prueba intentó salir a la red: ${url}`);
}) as typeof fetch;

process.env.TALKS_URL = TALKS_BASE;
process.env.TALKS_API_KEY = LLAVE_DEL_HUB;

// ─── Datos: eventos con y sin sesión de Talks guardada ───
const eConSesion = await evento('Sesión con Talks');
await sala(eConSesion, 'con-talks', { id: 's1abc', equipo: 'https://talks.ejemplo.test/equipo/s1abc', participantes: 'https://talks.ejemplo.test/p/000000000001' });
const eSesionFantasma = await evento('Sesión que Talks ya no conoce');
await sala(eSesionFantasma, 'fantasma', { id: 'sFantasma', equipo: 'https://talks.ejemplo.test/equipo/sFantasma', participantes: 'https://talks.ejemplo.test/p/000000000009' });
const eSalaSinTalks = await evento('Sala sin Talks');
await sala(eSalaSinTalks, 'sin-talks');
const eSinSala = await evento('Sin sala');

const ctxAna = { user: { id: 'u1', email: 'Ana@Ejemplo.test', firstName: 'Ana', lastName: 'López' } } as any; // el correo viene con mayúsculas a propósito
const ctxSinNombre = { user: { id: 'u3', email: 'beto@ejemplo.test' } } as any;
const ctxNoEstaEnLaLista = { user: { id: 'u2', email: 'nadie@ejemplo.test', firstName: 'Nadie', lastName: 'Más' } } as any;
const acceso = (id: string, ctx: any = ctxAna, extra: Record<string, unknown> = {}) => conBitacora(() => getTalksAccessLink.run({ calendarEventId: id, ...extra }, ctx)) as Promise<any>;
const ultimaLlamada = () => llamadasTalks[llamadasTalks.length - 1];

// ═══ El endpoint (servidor) ═══
await prueba('pide el pase con el correo de la sesión del Hub (en minúsculas), el nombre, el id de la sesión de Talks y la llave del Hub; devuelve la dirección con el pase', async () => {
  const r = await acceso(eConSesion);
  assert.deepEqual(Object.keys(r), ['url']);
  assert.equal(r.url, `${TALKS_BASE}/entrar-hub#c=PASE-1-SECRETO`);
  assert.equal(llamadasTalks.length, 1);
  const l = ultimaLlamada();
  assert.deepEqual([l.metodo, l.url, l.auth], ['POST', '/api/v1/acceso-equipo', `Bearer ${LLAVE_DEL_HUB}`]);
  assert.deepEqual(l.cuerpo, { email: 'ana@ejemplo.test', nombre: 'Ana López', sesionId: 's1abc' });
});

await prueba('el correo es SIEMPRE el de la sesión: uno mandado en la petición se ignora', async () => {
  const r = await acceso(eConSesion, ctxAna, { email: 'beto@ejemplo.test', nombre: 'Otra Persona', sesionId: 's2abc' });
  assert.ok(r.url);
  assert.deepEqual(ultimaLlamada().cuerpo, { email: 'ana@ejemplo.test', nombre: 'Ana López', sesionId: 's1abc' });
});

await prueba('cada llamada pide un pase nuevo (no se reutiliza ninguno): dos llamadas seguidas, dos pases distintos', async () => {
  const antes = llamadasTalks.length;
  const a = await acceso(eConSesion);
  const b = await acceso(eConSesion);
  assert.equal(llamadasTalks.length - antes, 2);
  assert.notEqual(a.url, b.url);
  assert.match(a.url, /#c=PASE-\d+-SECRETO$/);
});

await prueba('el cliente manda el correo en minúsculas y sin espacios, y el nombre recortado a 60 caracteres', async () => {
  const r = await pedirAccesoEquipoTalks({ email: '  ANA@Ejemplo.TEST ', nombre: ` ${'N'.repeat(80)} `, sesionId: 's1abc' });
  assert.equal(r.ok, true);
  assert.deepEqual(ultimaLlamada().cuerpo, { email: 'ana@ejemplo.test', nombre: 'N'.repeat(60), sesionId: 's1abc' });
  // un correo sin arroba ni se intenta (no se le habla a Talks)
  const antes = llamadasTalks.length;
  const mal = await pedirAccesoEquipoTalks({ email: 'no-es-un-correo' });
  assert.equal(mal.ok, false);
  assert.equal(llamadasTalks.length, antes);
});

await prueba('si la persona no tiene nombre en el Hub, no se manda nombre (Talks lo arma con el correo)', async () => {
  const r = await acceso(eConSesion, ctxSinNombre);
  assert.ok(r.url);
  assert.deepEqual(ultimaLlamada().cuerpo, { email: 'beto@ejemplo.test', sesionId: 's1abc' });
});

await prueba('quién entra lo decide el Hub: cualquier persona con sesión del Hub recibe su pase (Talks ya no compara el correo con ninguna lista), con su propio correo', async () => {
  const r = await acceso(eConSesion, ctxNoEstaEnLaLista);
  assert.match(r.url, /#c=PASE-\d+-SECRETO$/);
  assert.deepEqual(ultimaLlamada().cuerpo, { email: 'nadie@ejemplo.test', nombre: 'Nadie Más', sesionId: 's1abc' });
});

await prueba('Talks no conoce la sesión (404): motivo «no-encontrada»', async () => {
  assert.deepEqual(await acceso(eSesionFantasma), { motivo: 'no-encontrada' });
});

await prueba('la llave del Hub no coincide (401): motivo «no-disponible» (nunca un 401 hacia el navegador, parecería que se venció la sesión)', async () => {
  process.env.TALKS_API_KEY = 'otra-llave-que-no-coincide';
  try { assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' }); } finally { process.env.TALKS_API_KEY = LLAVE_DEL_HUB; }
});

await prueba('Talks caído (503), con datos rechazados (400), con una redirección o con un 403: motivo «no-disponible» (el link normal y el aviso general, sin culpar a nadie)', async () => {
  for (const modo of ['caido', 'datos-malos', 'redireccion', 'prohibido'] as const) {
    talksModo = modo;
    try { assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' }, modo); } finally { talksModo = 'normal'; }
  }
});

await prueba('Talks sin conexión (nadie escucha en esa dirección): motivo «no-disponible» y pronto, sin error de pantalla', async () => {
  const antes = process.env.TALKS_URL;
  process.env.TALKS_URL = `http://127.0.0.1:${puertoCerrado}`;
  const t0 = Date.now();
  try { assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' }); } finally { process.env.TALKS_URL = antes; }
  assert.ok(Date.now() - t0 < 3000, 'debía fallar de inmediato, no esperar el plazo');
});

await prueba('Talks que no contesta: se espera 8 segundos como máximo y cae a «no-disponible» (aquí con plazo corto para no esperar)', async () => {
  assert.equal(ESPERA_ACCESO_MS, 8000, 'el plazo acordado es de unos 8 segundos');
  talksModo = 'lento';
  const t0 = Date.now();
  try {
    const r = await pedirAccesoEquipoTalks({ email: 'ana@ejemplo.test', sesionId: 's1abc', esperaMs: 300 });
    assert.equal(r.ok, false);
    assert.deepEqual([(r as { motivo?: string }).motivo, (r as { estado?: unknown }).estado], ['no-disponible', 'sin-respuesta']);
  } finally { talksModo = 'normal'; for (const r of colgadas.splice(0)) r.destroy(); }
  const tardo = Date.now() - t0;
  assert.ok(tardo >= 250 && tardo < 3000, `tardó ${tardo} ms`);
});

await prueba('una dirección que no es de Talks, que no es https o que no viene, nunca se entrega (ni «javascript:»): motivo «no-disponible»', async () => {
  for (const modo of ['url-ajena', 'url-rara', 'sin-url'] as const) {
    talksModo = modo;
    try { assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' }, modo); } finally { talksModo = 'normal'; }
  }
});

await prueba('la dirección de los links que Talks ya dio para esa sesión también vale (por si TALKS_URL y su dirección pública no coinciden)', async () => {
  talksModo = 'url-de-los-links';
  try {
    const r = await acceso(eConSesion);
    assert.match(r.url, /^https:\/\/talks\.ejemplo\.test\/entrar-hub#c=PASE-\d+-SECRETO$/);
  } finally { talksModo = 'normal'; }
});

await prueba('un evento sin sesión de Talks guardada (sala sin Talks, o sin sala): motivo «sin-sesion» y NO se le habla a Talks', async () => {
  const antes = llamadasTalks.length;
  assert.deepEqual(await acceso(eSalaSinTalks), { motivo: 'sin-sesion' });
  assert.deepEqual(await acceso(eSinSala), { motivo: 'sin-sesion' });
  assert.equal(llamadasTalks.length, antes);
});

await prueba('sin Talks conectado (falta TALKS_URL o la llave): motivo «no-disponible», sin salir a la red', async () => {
  const url = process.env.TALKS_URL, llave = process.env.TALKS_API_KEY;
  const antes = llamadasTalks.length;
  try {
    delete process.env.TALKS_URL;
    assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' });
    process.env.TALKS_URL = url; delete process.env.TALKS_API_KEY;
    assert.deepEqual(await acceso(eConSesion), { motivo: 'no-disponible' });
  } finally { process.env.TALKS_URL = url; process.env.TALKS_API_KEY = llave; }
  assert.equal(llamadasTalks.length, antes);
});

await prueba('hay que haber iniciado sesión en el Hub, y el evento tiene que estar guardado', async () => {
  const antes = llamadasTalks.length;
  const sinSesion = await falla(() => getTalksAccessLink.run({ calendarEventId: eConSesion }, { user: null }));
  assert.equal(sinSesion.code, 'UNAUTHORIZED');
  const provisional = await falla(() => getTalksAccessLink.run({ calendarEventId: 'temp-123' }, ctxAna));
  assert.equal(provisional.code, 'BAD_REQUEST');
  assert.equal(llamadasTalks.length, antes);
});

await prueba('el pase no queda en ningún lado: ni en los registros del servidor, ni en la base de datos; y los fallos no llevan dirección ni correo', async () => {
  const texto = registros.join('\n');
  assert.ok(!/PASE-\d+-SECRETO|entrar-hub/.test(texto), 'la dirección del pase apareció en los registros');
  assert.ok(!texto.includes(LLAVE_DEL_HUB), 'la llave del Hub apareció en los registros');
  assert.ok(!/@ejemplo\.test/.test(texto), 'un correo apareció en los registros');
  const base = JSON.stringify((await pg.query(`select * from observation_sessions`)).rows);
  assert.ok(!/PASE-|entrar-hub/.test(base), 'el pase quedó guardado en la base');
  // y sí hay un renglón por cada fallo (para que quien administra el Hub lo vea), pero solo con el motivo y un código, sin datos
  for (const esperado of ['no-encontrada \\(404\\)', 'no-disponible \\(401\\)', 'no-disponible \\(403\\)', 'no-disponible \\(503\\)', 'no-disponible \\(400\\)', 'no-disponible \\(sin-respuesta\\)', 'no-disponible \\(respuesta-rara\\)']) {
    assert.ok(registros.some((r) => new RegExp(`^\\[getTalksAccessLink\\] Talks no dio el pase: ${esperado}$`).test(r)), `falta el renglón «${esperado}»`);
  }
});

// ═══ La lógica de la pantalla (src/lib/talksAbrir.ts) ═══
const LINK = 'https://talks.ejemplo.test/equipo/s1abc';
const PASE = 'https://talks.ejemplo.test/entrar-hub#c=PASE-X';
function armar(opts: { ventana?: boolean; respuesta?: () => Promise<ResultadoAcceso>; linkEquipo?: string; esperaMs?: number } = {}) {
  const sucesos: string[] = [];
  const navegaciones: string[] = [];
  const avisos: string[] = [];
  let cerrada = false;
  let pedidos = 0;
  const ventana: VentanaTalks = { navegar: (u) => { sucesos.push('navegar'); navegaciones.push(u); }, cerrar: () => { cerrada = true; } };
  const deps = {
    linkEquipo: opts.linkEquipo ?? LINK,
    abrirVentana: () => { sucesos.push('abrirVentana'); return opts.ventana === false ? null : ventana; },
    pedirAcceso: () => { sucesos.push('pedirAcceso'); pedidos++; return (opts.respuesta ?? (async () => ({ url: PASE })))(); },
    avisar: (t: string) => { sucesos.push('avisar'); avisos.push(t); },
    esperaMs: opts.esperaMs ?? 2000,
  };
  return { deps, sucesos, navegaciones, avisos, estado: () => ({ cerrada, pedidos }) };
}

await prueba('pantalla: el pase llega y se pone en la ventana que ya estaba abierta (la ventana se abre ANTES de pedir el pase, si no el navegador la bloquea)', async () => {
  const t = armar();
  assert.equal(await abrirEnTalks(t.deps), 'directo');
  assert.deepEqual(t.sucesos, ['abrirVentana', 'pedirAcceso', 'navegar']);
  assert.deepEqual(t.navegaciones, [PASE]);
  assert.deepEqual(t.avisos, []);
});

await prueba('pantalla: si no hay pase (Talks no conoce la sesión, está caído, el evento no tiene sesión guardada), se abre el link normal en esa misma ventana con el aviso general', async () => {
  for (const motivo of ['no-encontrada', 'no-disponible', 'sin-sesion'] as const) {
    const t = armar({ respuesta: async () => ({ motivo }) });
    assert.equal(await abrirEnTalks(t.deps), 'link-normal', motivo);
    assert.deepEqual(t.navegaciones, [LINK], motivo);
    assert.deepEqual(t.avisos, [AVISO_SIN_ENTRADA_DIRECTA], motivo);
  }
  assert.equal(AVISO_SIN_ENTRADA_DIRECTA, 'No pudimos entrar directo a Talks; te va a pedir tu correo.');
});

await prueba('pantalla: si el servidor del Hub falla o se cae la red (la petición se rechaza), no se queda atascado: link normal y aviso', async () => {
  const t = armar({ respuesta: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(await abrirEnTalks(t.deps), 'link-normal');
  assert.deepEqual(t.navegaciones, [LINK]);
  assert.deepEqual(t.avisos, [AVISO_SIN_ENTRADA_DIRECTA]);
});

await prueba('pantalla: si no hay respuesta a tiempo, se abre el link normal; y un pase que llegue tarde ya no abre nada más', async () => {
  let llega: (r: ResultadoAcceso) => void = () => {};
  const t = armar({ esperaMs: 60, respuesta: () => new Promise<ResultadoAcceso>((ok) => { llega = ok; }) });
  assert.equal(await abrirEnTalks(t.deps), 'link-normal');
  assert.deepEqual(t.navegaciones, [LINK]);
  assert.deepEqual(t.avisos, [AVISO_SIN_ENTRADA_DIRECTA]);
  llega({ url: PASE }); // llega tarde
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(t.navegaciones, [LINK], 'el pase tardío no debía abrir otra cosa');
  assert.equal(ESPERA_ACCESO_PANTALLA_MS, 10_000);
});

await prueba('pantalla: si el navegador no deja abrir la ventana, se avisa y NO se pide ningún pase (se gastaría sin usarse)', async () => {
  const t = armar({ ventana: false });
  assert.equal(await abrirEnTalks(t.deps), 'bloqueada');
  assert.deepEqual(t.sucesos, ['abrirVentana', 'avisar']);
  assert.deepEqual(t.avisos, [AVISO_VENTANA_BLOQUEADA]);
  assert.equal(t.estado().pedidos, 0);
});

await prueba('pantalla: una dirección que no sea web (por ejemplo «javascript:») nunca se pone en la ventana: se abre el link normal', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hola', 'no es una dirección', '']) {
    const t = armar({ respuesta: async () => ({ url }) });
    assert.equal(await abrirEnTalks(t.deps), 'link-normal', url);
    assert.deepEqual(t.navegaciones, [LINK], url);
  }
});

await prueba('pantalla: si el link normal tampoco sirve (no es web) y no hay pase, se cierra la ventana y se avisa', async () => {
  const t = armar({ linkEquipo: 'javascript:alert(1)', respuesta: async () => ({ motivo: 'no-disponible' }) });
  assert.equal(await abrirEnTalks(t.deps), 'sin-link');
  assert.deepEqual(t.navegaciones, []);
  assert.equal(t.estado().cerrada, true);
  assert.deepEqual(t.avisos, [AVISO_LINK_NO_VALIDO]);
});

await prueba('pantalla: cada clic pide su propio pase (nada se guarda ni se reutiliza)', async () => {
  const t = armar();
  await abrirEnTalks(t.deps);
  await abrirEnTalks(t.deps);
  assert.equal(t.estado().pedidos, 2);
});

await prueba('pantalla: esDireccionWeb solo acepta http y https', () => {
  assert.equal(esDireccionWeb('https://talks.mx/entrar-hub#c=1'), true);
  assert.equal(esDireccionWeb('http://localhost:3000/x'), true);
  for (const mal of ['javascript:alert(1)', 'ftp://x.test/a', 'talks.mx', '', undefined, null, 42]) assert.equal(esDireccionWeb(mal), false, String(mal));
});

await prueba('pantalla: los avisos están en español llano y sin «·»', () => {
  for (const aviso of [AVISO_SIN_ENTRADA_DIRECTA, AVISO_VENTANA_BLOQUEADA, AVISO_LINK_NO_VALIDO]) {
    assert.ok(aviso.length > 20 && !aviso.includes('·'), aviso);
    assert.ok(!/error|token|pase|403|404|401/i.test(aviso), `jerga en: ${aviso}`);
  }
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
for (const s of conexiones) s.destroy();
servidorTalks.close();
globalThis.fetch = fetchReal;
process.exit(fallas ? 1 : 0);
