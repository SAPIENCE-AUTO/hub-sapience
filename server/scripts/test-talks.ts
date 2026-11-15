// Pruebas del botón «Crear links de sesión» (Hub ↔ Talks) sin tocar nada real: una base en memoria (PGlite) con el esquema real, un Talks de mentira
// (servidor HTTP local que imita sus dos rutas: crear/recuperar la sesión de un evento y consultarla) y un Mux de mentira. Cualquier llamada a otra dirección
// hace fallar la prueba, así que no hay forma de que llegue al Talks ni al Mux de verdad. Llaves y datos inventados.
// Revisa: que la primera llamada cree y la segunda devuelva la misma sin crear nada doble (ni en Mux, ni en Talks, ni en la base, tampoco con dos clics a la vez),
// que se guarden el id y los dos links junto a la sala, que la llave de transmisión solo viaje en el cuerpo del POST (ni en la URL, ni en la respuesta, ni en los
// registros), que los errores de Talks (400, 401, no disponible...) salgan en español llano y sin 401 hacia el navegador, que sin Talks conectado o sin la migración
// no se cree nada a medias, que «Crear links de sesión» nunca cree la reunión de Zoom (aunque Zoom esté configurado), y las dos reglas de la pantalla (el botón solo
// en eventos guardados; «Crear» la primera vez y «Abrir» después).
// uso: node server/node_modules/.bin/tsx server/scripts/test-talks.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import createTalksSession from '../../src/api/createTalksSession';
import getTalksSession from '../../src/api/getTalksSession';
import { provisionObservationSession } from '../../src/serverUtils/provisionObservationSession';
import { esEventoGuardado, etiquetaBotonTalks } from '../../src/lib/talksSesion';

// ─── Registros: todo lo que los endpoints escriben en consola se guarda aparte, para revisar al final que no se filtró ninguna llave ───
const registros: string[] = [];
let nivelBitacora = 0; // dos llamadas a la vez (los dos clics) no deben pisarse al guardar y devolver la consola
let consolaOriginal: Pick<Console, 'log' | 'warn' | 'error'> | null = null;
const conBitacora = async <T>(f: () => Promise<T>): Promise<T> => {
  if (nivelBitacora++ === 0) {
    consolaOriginal = { log: console.log, warn: console.warn, error: console.error };
    const guardar = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 4 }))).join(' ')); };
    console.log = guardar;
    console.warn = guardar;
    console.error = guardar;
  }
  try {
    return await f();
  } finally {
    if (--nivelBitacora === 0 && consolaOriginal) { Object.assign(console, consolaOriginal); consolaOriginal = null; }
  }
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
/** Corre algo que debe fallar y devuelve el error (con su `code` y `status` si es ZiteError). */
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
// observation_sessions no sale del esquema generado: la crea add-observation-room-tables.ts. Aquí va igual, trimmed a lo que se usa y SIN las columnas de Talks
// (las agrega la migración nueva, que se prueba más abajo).
await pg.exec(`
  create table observation_sessions (
    id uuid primary key default gen_random_uuid(),
    calendar_event_id uuid references calendar_events(id) on delete set null,
    slug text unique not null,
    nombre text, cliente text,
    mux_live_stream_id text, mux_stream_key text, mux_playback_id text, mux_asset_id text,
    estado text not null default 'borrador',
    zoom_meeting_id text, zoom_join_url text, zoom_start_url text, zoom_host_email text, zoom_needs_update boolean,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
await pg.query(`insert into projects (project_code, status, client) values ('P-UNO', 'En curso', 'Cliente de Prueba')`);

const evento = async (nombre: string | null) =>
  (await pg.query<{ id: string }>(`insert into calendar_events (event_name, project_code, calendar_name) values ($1, 'P-UNO', 'Cal') returning id`, [nombre])).rows[0].id;
const salas = async (eventoId: string) => (await pg.query<any>(`select * from observation_sessions where calendar_event_id = $1`, [eventoId])).rows;
const totalSalas = async () => Number((await pg.query<{ c: string }>(`select count(*) c from observation_sessions`)).rows[0].c);

// ─── Mux de mentira (la función que arma la transmisión llama a api.mux.com con fetch) ───
const llavesMux: string[] = [];
let muxCreados = 0;
let muxProximaLlave: string | null = null;
let muxCaido = false;
const llamadasZoom: string[] = []; // cada vez que algo le habla a Zoom (nunca debe pasar al crear links de sesión)
process.env.ZITE_MUX_TOKEN_ID = 'token-de-mentira';
process.env.ZITE_MUX_TOKEN_SECRET = 'secreto-de-mentira';
delete process.env.ZITE_ZOOM_HOST_EMAILS; // sin cuentas de Zoom: la sala se arma solo con Mux

// ─── Talks de mentira: imita las dos rutas del contrato, con los mismos códigos de respuesta ───
const LLAVE_DEL_HUB = 'llave-del-hub-de-mentira-9f3a';
type SesionFalsa = { id: string; nombre: string; codigo: string; externoId: string; muxStreamKey?: string };
const sesionesFalsas = new Map<string, SesionFalsa>();
const llamadasTalks: Array<{ metodo: string; url: string; auth?: string; cuerpo?: any }> = [];
let talksModo: 'normal' | 'caido' | 'redireccion' | 'basura' | 'enlace-malo' | 'sin-llave' = 'normal';
let contadorTalks = 0;

const salidaTalks = (s: SesionFalsa, yaExistia: boolean) => ({
  id: s.id,
  nombre: s.nombre,
  codigo: s.codigo,
  linkParticipantes: `https://talks.ejemplo.test/p/${s.codigo}`,
  linkEquipo: talksModo === 'enlace-malo' ? 'javascript:alert(1)' : `https://talks.ejemplo.test/equipo/${s.id}`,
  externoId: s.externoId,
  yaExistia,
  transmision: talksModo === 'sin-llave' ? 'sin-llave' : s.muxStreamKey ? 'lista' : 'sin-llave',
});

const servidorTalks = http.createServer(async (req, res) => {
  const trozos: Buffer[] = [];
  for await (const t of req) trozos.push(t as Buffer);
  const crudo = Buffer.concat(trozos).toString('utf8');
  let cuerpo: any;
  try { cuerpo = crudo ? JSON.parse(crudo) : undefined; } catch { cuerpo = undefined; }
  llamadasTalks.push({ metodo: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, cuerpo });
  const json = (status: number, obj: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (talksModo === 'caido') return json(503, { error: 'en mantenimiento' });
  if (talksModo === 'redireccion') { res.writeHead(302, { Location: 'https://otro.ejemplo.test/' }); return res.end(); }
  if (req.headers.authorization !== `Bearer ${LLAVE_DEL_HUB}`) return json(401, { error: 'llave inválida' });

  const url = new URL(req.url ?? '/', 'http://talks.local');
  if (req.method === 'POST' && url.pathname === '/api/v1/sesiones') {
    if (talksModo === 'basura') return json(200, { hola: 'mundo' });
    const b = cuerpo ?? {};
    if (typeof b.nombre !== 'string' || !b.nombre.trim() || b.nombre.length > 120) return json(400, { error: 'nombre inválido (obligatorio, hasta 120 caracteres)' });
    if (typeof b.externoId !== 'string' || !b.externoId) return json(400, { error: 'externoId obligatorio' });
    if (b.muxStreamKey !== undefined && !/^[A-Za-z0-9-]{8,100}$/.test(b.muxStreamKey)) return json(400, { error: `muxStreamKey inválida (${b.muxStreamKey})` });
    if (b.observacionUrl !== undefined && !/^https:\/\//.test(b.observacionUrl)) return json(400, { error: 'observacionUrl debe ser https' });
    let s = sesionesFalsas.get(b.externoId);
    const yaExistia = !!s;
    if (s) {
      s.nombre = b.nombre;
      if (b.muxStreamKey) s.muxStreamKey = b.muxStreamKey;
    } else {
      contadorTalks++;
      s = { id: `s${contadorTalks}abc`, nombre: b.nombre, codigo: String(contadorTalks).padStart(12, '0'), externoId: b.externoId, muxStreamKey: b.muxStreamKey };
      sesionesFalsas.set(b.externoId, s);
    }
    return json(yaExistia ? 200 : 201, salidaTalks(s, yaExistia));
  }
  const m = url.pathname.match(/^\/api\/v1\/sesiones\/evento\/(.+)$/);
  if (req.method === 'GET' && m) {
    const s = sesionesFalsas.get(decodeURIComponent(m[1]));
    return s ? json(200, salidaTalks(s, true)) : json(404, { error: 'ese evento todavía no tiene sesión' });
  }
  return json(404, { error: 'ruta desconocida' });
});
await new Promise<void>((ok) => servidorTalks.listen(0, '127.0.0.1', ok));
const TALKS_BASE = `http://127.0.0.1:${(servidorTalks.address() as AddressInfo).port}`;

// Un puerto cerrado de verdad (para «Talks no responde»).
const puertoCerrado = await new Promise<number>((ok) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); });
});

// ─── fetch: Mux de mentira, Talks local, y cualquier otra cosa hace fallar la prueba ───
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.mux.com/')) {
    if (muxCaido) return new Response('{"error":"caído"}', { status: 500 });
    await new Promise((r) => setTimeout(r, 30)); // lo bastante lento para que dos clics a la vez se encimen de verdad
    muxCreados++;
    const llave = muxProximaLlave ?? `mux-llave-${String(muxCreados).padStart(3, '0')}-abcd-efgh`;
    muxProximaLlave = null;
    llavesMux.push(llave);
    return new Response(
      JSON.stringify({ data: { id: `ls-${muxCreados}`, stream_key: llave, playback_ids: [{ id: `pb-${muxCreados}`, policy: 'public' }] } }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (url.startsWith('http://127.0.0.1:')) return fetchReal(input, init);
  if (url.startsWith('https://zoom.us/') || url.startsWith('https://api.zoom.us/')) {
    llamadasZoom.push(url);
    // Zoom de mentira que no deja pasar: la función de siempre lo toma como «Zoom falló» y arma la sala sin Zoom, que es lo que se quiere ver aquí.
    return new Response('{"reason":"Zoom de mentira: sin acceso"}', { status: 401 });
  }
  throw new Error(`La prueba intentó salir a la red: ${url}`);
}) as typeof fetch;

const ctx = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
const crear = (id: string) => conBitacora(() => createTalksSession.run({ calendarEventId: id }, ctx)) as Promise<any>;
const consultar = (id: string) => conBitacora(() => getTalksSession.run({ calendarEventId: id }, ctx)) as Promise<any>;
const posts = () => llamadasTalks.filter((l) => l.metodo === 'POST');
const gets = () => llamadasTalks.filter((l) => l.metodo === 'GET');
const configurar = (opc: { url?: string | null; llave?: string | null; app?: string } = {}) => {
  const poner = (k: string, v: string | null | undefined, porDefecto: string) => { const x = v === undefined ? porDefecto : v; if (x === null) delete process.env[k]; else process.env[k] = x; };
  poner('TALKS_URL', opc.url, TALKS_BASE);
  poner('TALKS_API_KEY', opc.llave, LLAVE_DEL_HUB);
  process.env.ZITE_APP_URL = opc.app ?? 'https://hub.ejemplo.test';
};
configurar();

// ═══ Reglas de la pantalla ═══
await prueba('el botón solo aparece en un evento guardado (con su id real); «Crear» la primera vez y «Abrir» después', () => {
  assert.equal(esEventoGuardado('3f6c1b0a-8d2e-4b7a-9c11-5e0d7a4f2b19'), true);
  for (const sinGuardar of [undefined, null, '', 'temp-123', 'nuevo', '3f6c1b0a']) assert.equal(esEventoGuardado(sinGuardar as any), false, `«${sinGuardar}» no es un evento guardado`);
  assert.equal(etiquetaBotonTalks(null), 'Crear links de sesión');
  assert.equal(etiquetaBotonTalks(undefined), 'Crear links de sesión');
  assert.equal(etiquetaBotonTalks({ talksSessionId: 's1', linkEquipo: 'https://x.test/e', linkParticipantes: 'https://x.test/p' }), 'Abrir en Talks');
});

// ═══ Antes de la migración: la base todavía no tiene las columnas nuevas ═══
const eSinMigrar = await evento('Evento antes de migrar');
await prueba('sin la migración: avisa en claro y no crea nada (ni en Mux, ni en Talks, ni en la base)', async () => {
  const err = await falla(() => crear(eSinMigrar));
  assert.equal(err.code, 'INTERNAL_ERROR');
  assert.match(err.message, /Falta preparar la base de datos para Talks/);
  assert.equal(muxCreados, 0);
  assert.equal(llamadasTalks.length, 0);
  assert.equal(await totalSalas(), 0);
});
await prueba('sin la migración, consultar tampoco rompe: dice lo mismo en claro', async () => {
  const err = await falla(() => consultar(eSinMigrar));
  assert.match(err.message, /Falta preparar la base de datos para Talks/);
});

await prueba('la migración (el script, tal cual) agrega las tres columnas y se puede correr dos veces', async () => {
  const guion = fs.readFileSync(new URL('./add-observation-talks-columns.ts', import.meta.url), 'utf8');
  const sql = guion.match(/pool\.query\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql, 'no se encontró el SQL del script');
  await pg.exec(sql);
  await pg.exec(sql);
  const { rows } = await pg.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'observation_sessions' and column_name like 'talks\\_%' order by column_name`,
  );
  assert.deepEqual(rows.map((r) => r.column_name), ['talks_link_equipo', 'talks_link_participantes', 'talks_session_id']);
});

// ═══ Sin Talks conectado ═══
await prueba('sin TALKS_URL o sin TALKS_API_KEY: avisa en claro y no crea nada, ni siquiera la transmisión de Mux', async () => {
  for (const mala of [{ url: null }, { llave: null }, { url: '' }, { url: 'ftp://talks.ejemplo.test' }, { url: 'http://talks.ejemplo.test' }, { url: 'no es una dirección' }]) {
    configurar(mala as any);
    const e = await evento('Sin Talks conectado');
    const err = await falla(() => crear(e));
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.match(err.message, /Talks/);
    assert.equal(muxCreados, 0);
    assert.equal(llamadasTalks.length, 0);
    assert.equal(await totalSalas(), 0);
  }
  configurar();
  const eX = await evento('x');
  configurar({ url: null });
  assert.match((await falla(() => crear(eX))).message, /todavía no está conectado/);
  configurar({ url: 'http://talks.ejemplo.test' });
  assert.match((await falla(() => crear(eX))).message, /debe empezar con https/);
  configurar();
});

// ═══ Crear, recuperar, no duplicar ═══
const e1 = await evento('Grupo 1 Aperol');
let r1: any;
await prueba('la primera vez crea la transmisión de Mux, la sesión en Talks, y guarda el id y los links junto a la sala', async () => {
  r1 = await crear(e1);
  assert.equal(r1.yaExistia, false);
  assert.equal(r1.transmision, 'lista');
  assert.match(r1.linkEquipo, /^https:\/\/talks\.ejemplo\.test\/equipo\//);
  assert.match(r1.linkParticipantes, /^https:\/\/talks\.ejemplo\.test\/p\//);
  assert.equal(muxCreados, 1);
  assert.equal(posts().length, 1);
  assert.equal(sesionesFalsas.size, 1);
  const filas = await salas(e1);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].talks_session_id, r1.talksSessionId);
  assert.equal(filas[0].talks_link_equipo, r1.linkEquipo);
  assert.equal(filas[0].talks_link_participantes, r1.linkParticipantes);
  assert.equal(filas[0].mux_stream_key, llavesMux[0]);
});

await prueba('al llamar a Talks manda la llave del Hub, el nombre, el id del evento y la llave de Mux solo en el cuerpo; la URL no lleva nada secreto', () => {
  const p = posts()[0];
  assert.equal(p.auth, `Bearer ${LLAVE_DEL_HUB}`);
  assert.equal(p.url, '/api/v1/sesiones');
  assert.equal(p.cuerpo.nombre, 'Grupo 1 Aperol');
  assert.equal(p.cuerpo.externoId, e1);
  assert.equal(p.cuerpo.muxStreamKey, llavesMux[0]);
  assert.match(p.cuerpo.observacionUrl, /^https:\/\/hub\.ejemplo\.test\/s\/grupo-1-aperol-[0-9a-f]{8}$/);
});

await prueba('la respuesta del Hub no trae la llave de transmisión de Mux', async () => {
  assert.ok(!JSON.stringify(r1).includes(llavesMux[0]));
  assert.ok(!JSON.stringify(await consultar(e1)).includes(llavesMux[0]));
});

await prueba('apretarlo otra vez devuelve la misma sesión (yaExistia: true) y no crea nada doble en Mux, en Talks ni en la base', async () => {
  const r2 = await crear(e1);
  assert.equal(r2.yaExistia, true);
  assert.equal(r2.talksSessionId, r1.talksSessionId);
  assert.equal(r2.linkEquipo, r1.linkEquipo);
  assert.equal(r2.linkParticipantes, r1.linkParticipantes);
  assert.equal(muxCreados, 1);
  assert.equal(sesionesFalsas.size, 1);
  assert.equal((await salas(e1)).length, 1);
  assert.equal(posts().length, 2); // se le preguntó a Talks otra vez (así se recupera lo perdido), pero Talks devolvió la misma
});

await prueba('dos clics a la vez para el mismo evento comparten el trabajo: una sola transmisión de Mux, una sola sesión, una sola sala', async () => {
  const e2 = await evento('Grupo 2 Aperol');
  const muxAntes = muxCreados;
  const postsAntes = posts().length;
  const [a, b] = await Promise.all([crear(e2), crear(e2)]);
  assert.deepEqual(a, b);
  assert.equal(a.yaExistia, false);
  assert.equal(muxCreados, muxAntes + 1);
  assert.equal(posts().length, postsAntes + 1);
  assert.equal((await salas(e2)).length, 1);
  assert.equal(sesionesFalsas.size, 2);
});

await prueba('si se renombra el evento y se vuelve a pedir, Talks recibe el nombre nuevo (misma sesión)', async () => {
  const e = [...sesionesFalsas.values()].find((s) => s.nombre === 'Grupo 2 Aperol')!.externoId;
  await pg.query(`update calendar_events set event_name = 'Grupo 2 Aperol (nuevo nombre)' where id = $1`, [e]);
  const antes = sesionesFalsas.get(e)!.id;
  const r = await crear(e);
  assert.equal(r.yaExistia, true);
  assert.equal(r.talksSessionId, `${antes}`);
  assert.equal(sesionesFalsas.get(e)!.nombre, 'Grupo 2 Aperol (nuevo nombre)');
});

await prueba('un nombre larguísimo se recorta a 120 caracteres y un evento sin nombre usa «Sesión de observación»', async () => {
  const larga = await evento('A'.repeat(200));
  await crear(larga);
  assert.equal(posts().at(-1)!.cuerpo.nombre.length, 120);
  const sinNombre = await evento(null);
  await crear(sinNombre);
  assert.equal(posts().at(-1)!.cuerpo.nombre, 'Sesión de observación');
});

await prueba('en desarrollo (el Hub en http://localhost) no manda observacionUrl, porque Talks solo la acepta https', async () => {
  configurar({ app: 'http://localhost:5173' });
  const e = await evento('Prueba local');
  await crear(e);
  assert.ok(!('observacionUrl' in posts().at(-1)!.cuerpo));
  configurar();
});

await prueba('«Crear links de sesión» no crea la reunión de Zoom aunque Zoom esté configurado y el evento tenga fecha; la función de siempre («Crear stream») sí la intenta', async () => {
  const antesEnv = { ...process.env };
  process.env.ZITE_ZOOM_ACCOUNT_ID = 'cuenta-de-mentira';
  process.env.ZITE_ZOOM_CLIENT_ID = 'cliente-de-mentira';
  process.env.ZITE_ZOOM_CLIENT_SECRET = 'secreto-de-mentira';
  process.env.ZITE_ZOOM_HOST_EMAILS = 'anfitrion@ejemplo.test';
  try {
    const conFecha = async (nombre: string) =>
      (await pg.query<{ id: string }>(
        `insert into calendar_events (event_name, project_code, calendar_name, event_date, duration_hours) values ($1, 'P-UNO', 'Cal', now() + interval '2 days', 2) returning id`,
        [nombre],
      )).rows[0].id;
    const e = await conFecha('Con fecha y con Zoom configurado');
    const antes = llamadasZoom.length;
    const r = await crear(e); // «Crear links de sesión»
    assert.equal(llamadasZoom.length, antes, 'Crear links de sesión le habló a Zoom');
    const fila = (await salas(e))[0];
    for (const campo of ['zoom_meeting_id', 'zoom_join_url', 'zoom_start_url', 'zoom_host_email']) assert.equal(fila[campo], null, `${campo} debía quedar vacío`);
    assert.equal(fila.talks_session_id, r.talksSessionId, 'los links de Talks sí se guardaron');
    assert.equal(fila.mux_stream_key, llavesMux.at(-1), 'la transmisión de Mux sí se creó');
    // Control: la función de siempre, con el mismo Zoom y un evento con fecha, sí lo intenta. Sin este control la prueba podría pasar sin probar nada.
    const control = await conFecha('Control: «Crear stream» de siempre');
    await conBitacora(() => provisionObservationSession(control));
    assert.ok(llamadasZoom.length > antes, 'la función de siempre debía intentar Zoom');
  } finally {
    for (const k of ['ZITE_ZOOM_ACCOUNT_ID', 'ZITE_ZOOM_CLIENT_ID', 'ZITE_ZOOM_CLIENT_SECRET', 'ZITE_ZOOM_HOST_EMAILS']) {
      if (antesEnv[k] === undefined) delete process.env[k]; else process.env[k] = antesEnv[k];
    }
  }
});

await prueba('un evento que no existe, un id que no es de evento guardado, o sin sesión iniciada: se rechaza sin crear nada', async () => {
  const muxAntes = muxCreados;
  const postsAntes = llamadasTalks.length;
  const noExiste = await falla(() => crear('00000000-0000-4000-8000-000000000000'));
  assert.equal(noExiste.code, 'NOT_FOUND');
  assert.match(noExiste.message, /ya no existe o todavía no se ha guardado/);
  const sinGuardar = await falla(() => crear('temp-123'));
  assert.equal(sinGuardar.code, 'BAD_REQUEST');
  const sinSesion = await falla(() => createTalksSession.run({ calendarEventId: e1 }, { user: null } as any));
  assert.equal(sinSesion.code, 'UNAUTHORIZED');
  assert.equal(muxCreados, muxAntes);
  assert.equal(llamadasTalks.length, postsAntes);
});

await prueba('un evento cuyo id tiene la forma de uuid pero no la versión estándar (como los que pudieron venir de la migración) también funciona', async () => {
  const raro = '11111111-2222-3333-4444-555555555555';
  assert.equal(esEventoGuardado(raro), true);
  assert.equal((await falla(() => crear('22222222-3333-4444-5555-666666666666'))).code, 'NOT_FOUND'); // pasa la validación; simplemente no existe
  await pg.query(`insert into calendar_events (id, event_name, project_code, calendar_name) values ($1, 'Evento con id viejo', 'P-UNO', 'Cal')`, [raro]);
  const r = await crear(raro);
  assert.equal(r.yaExistia, false);
  assert.equal((await consultar(raro)).existe, true);
});

// ═══ Errores de Talks: en español llano, sin 401 hacia el navegador, y sin dejar nada a medias que no se pueda recuperar ═══
// `talksYaLaCreo`: en ese caso Talks sí alcanzó a crear la sesión (y devolvió algo inservible), así que al reintentar la recupera en vez de crear otra.
async function errorYRecuperacion(titulo: string, provocar: () => void, restaurar: () => void, revisar: (err: any) => void, { talksYaLaCreo = false } = {}) {
  await prueba(titulo, async () => {
    const e = await evento(`Falla: ${titulo.slice(0, 20)}`);
    const sesionesAntes = sesionesFalsas.size;
    provocar();
    let err: any;
    try { err = await falla(() => crear(e)); } finally { restaurar(); }
    revisar(err);
    assert.notEqual(err.status, 401, 'un 401 hacia el navegador parecería que se venció la sesión de quien aprieta el botón');
    // Quedó la sala (transmisión de Mux) pero ningún dato de Talks guardado:
    const filas = await salas(e);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].talks_session_id, null);
    assert.equal(sesionesFalsas.size, sesionesAntes + (talksYaLaCreo ? 1 : 0));
    // Al volver Talks, apretar otra vez completa lo que faltaba sin crear otra transmisión ni otra sesión:
    const muxAntes = muxCreados;
    const ok = await crear(e);
    assert.equal(ok.yaExistia, talksYaLaCreo);
    assert.equal(muxCreados, muxAntes);
    assert.equal(sesionesFalsas.size, sesionesAntes + 1);
    assert.equal((await salas(e)).length, 1);
    assert.equal((await salas(e))[0].talks_session_id, ok.talksSessionId);
  });
}

await errorYRecuperacion(
  'Talks rechaza la llave del Hub (401): lo dice en claro y apretar otra vez, con la llave bien, completa todo',
  () => configurar({ llave: 'otra-llave-que-no-es' }),
  () => configurar(),
  (err) => {
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.match(err.message, /Talks no aceptó la llave del Hub/);
    assert.ok(!err.message.includes('otra-llave-que-no-es'));
  },
);
await errorYRecuperacion(
  'Talks caído (503): dice que no está disponible y que no se crea nada doble',
  () => { talksModo = 'caido'; },
  () => { talksModo = 'normal'; },
  (err) => {
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.match(err.message, /Talks no está disponible/);
    assert.match(err.message, /no se crea nada doble/);
  },
);
await errorYRecuperacion(
  'Talks sin conexión (la dirección no contesta): dice que no respondió',
  () => configurar({ url: `http://127.0.0.1:${puertoCerrado}` }),
  () => configurar(),
  (err) => {
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.match(err.message, /Talks no respondió/);
  },
);
await errorYRecuperacion(
  'Talks contesta con una redirección: no la sigue (no reenvía la llave de Mux a otra dirección) y avisa que TALKS_URL está mal',
  () => { talksModo = 'redireccion'; },
  () => { talksModo = 'normal'; },
  (err) => {
    assert.match(err.message, /redirección/);
    assert.ok(!llamadasTalks.some((l) => l.url.includes('otro.ejemplo.test')));
  },
);
await errorYRecuperacion(
  'Talks contesta algo que el Hub no entiende: lo dice en claro',
  () => { talksModo = 'basura'; },
  () => { talksModo = 'normal'; },
  (err) => assert.match(err.message, /algo que el Hub no entiende/),
);
await errorYRecuperacion(
  'Talks devuelve un link que no es http(s) (por ejemplo «javascript:»): no se guarda ni se muestra',
  () => { talksModo = 'enlace-malo'; },
  () => { talksModo = 'normal'; },
  (err) => assert.match(err.message, /algo que el Hub no entiende/),
  { talksYaLaCreo: true },
);

await prueba('Talks rechaza los datos (400): lo dice en claro y, aunque Talks repita la llave de Mux en su explicación, no sale en el mensaje', async () => {
  const e = await evento('Llave con formato raro');
  muxProximaLlave = 'llave_con_guion_bajo';
  const err = await falla(() => crear(e));
  assert.equal(err.code, 'BAD_REQUEST');
  assert.match(err.message, /Talks rechazó los datos de la sesión/);
  assert.ok(!err.message.includes('llave_con_guion_bajo'), 'la llave de transmisión salió en el mensaje');
  assert.equal((await salas(e))[0].talks_session_id, null);
});

await prueba('si Mux falla al armar la transmisión: dice en claro qué pasó y no deja sala ni sesión en Talks', async () => {
  const e = await evento('Mux caído');
  const salasAntes = await totalSalas();
  const postsAntes = posts().length;
  muxCaido = true;
  let err: any;
  try { err = await falla(() => crear(e)); } finally { muxCaido = false; }
  assert.match(err.message, /No se pudo crear la transmisión de Mux/);
  assert.equal(await totalSalas(), salasAntes);
  assert.equal(posts().length, postsAntes);
});

await prueba('si Talks avisa «sin-llave» se lo dice a la pantalla (EN VIVO no podría transmitir)', async () => {
  talksModo = 'sin-llave';
  try {
    const r = await crear(await evento('Sin llave en Talks'));
    assert.equal(r.transmision, 'sin-llave');
  } finally { talksModo = 'normal'; }
});

// ═══ Consultar sin crear ═══
await prueba('consultar un evento sin sala no crea nada y ni siquiera le pregunta a Talks', async () => {
  const e = await evento('Todavía sin sala');
  const llamadas = llamadasTalks.length;
  const salasAntes = await totalSalas();
  assert.deepEqual(await consultar(e), { existe: false });
  assert.equal(llamadasTalks.length, llamadas);
  assert.equal(muxCreados, llavesMux.length);
  assert.equal(await totalSalas(), salasAntes);
});

await prueba('consultar un evento con sesión guardada devuelve lo guardado, sin preguntarle a Talks', async () => {
  const llamadas = llamadasTalks.length;
  const r = await consultar(e1);
  // También trae el link de observación del cliente (el mismo que devolvió crear): la fila de la lista del calendario lo muestra junto a los de Talks.
  assert.deepEqual(r, { existe: true, talksSessionId: r1.talksSessionId, linkEquipo: r1.linkEquipo, linkParticipantes: r1.linkParticipantes, observationUrl: r1.observationUrl });
  assert.ok(r.observationUrl.endsWith(`/s/${(await salas(e1))[0].slug}`));
  assert.equal(llamadasTalks.length, llamadas);
});

/** Un evento con sala pero sin nada guardado de Talks (se creó la sala y Talks falló). */
async function eventoConSalaSinTalks(nombre: string): Promise<string> {
  const e = await evento(nombre);
  talksModo = 'caido';
  try { await falla(() => crear(e)); } finally { talksModo = 'normal'; }
  const fila = (await salas(e))[0];
  assert.ok(fila && fila.talks_session_id === null);
  return e;
}

await prueba('con sala pero nada guardado: si Talks ya tiene la sesión del evento, la recupera, la guarda y deja de preguntar', async () => {
  const e = await eventoConSalaSinTalks('Se perdió la copia');
  sesionesFalsas.set(e, { id: 'sRecuperada', nombre: 'Se perdió la copia', codigo: '999999999999', externoId: e, muxStreamKey: llavesMux.at(-1) });
  const getsAntes = gets().length;
  const r = await consultar(e);
  assert.equal(r.existe, true);
  assert.equal(r.talksSessionId, 'sRecuperada');
  assert.equal(r.linkEquipo, 'https://talks.ejemplo.test/equipo/sRecuperada');
  assert.equal(gets().length, getsAntes + 1);
  assert.equal(gets().at(-1)!.url, `/api/v1/sesiones/evento/${e}`);
  assert.equal(gets().at(-1)!.auth, `Bearer ${LLAVE_DEL_HUB}`);
  assert.equal((await salas(e))[0].talks_session_id, 'sRecuperada');
  await consultar(e);
  assert.equal(gets().length, getsAntes + 1, 'ya está guardado: no vuelve a preguntar');
});

await prueba('con sala pero nada guardado: si Talks no tiene la sesión (404), responde que no existe, sin aviso de error', async () => {
  const e = await eventoConSalaSinTalks('Sin sesión en Talks');
  assert.deepEqual(await consultar(e), { existe: false });
});

await prueba('consultar con Talks caído o sin conectar no rompe la pantalla: responde con un aviso en español llano', async () => {
  const e = await eventoConSalaSinTalks('Talks no contesta');
  talksModo = 'caido';
  try {
    const r = await consultar(e);
    assert.equal(r.existe, false);
    assert.match(r.aviso, /Talks no está disponible/);
  } finally { talksModo = 'normal'; }
  configurar({ url: null });
  try {
    const r = await consultar(e);
    assert.equal(r.existe, false);
    assert.match(r.aviso, /todavía no está conectado/);
  } finally { configurar(); }
});

await prueba('consultar tampoco crea nada: no hay POST por consultar ni sesiones nuevas en Talks', async () => {
  const e = await eventoConSalaSinTalks('Solo consultar');
  const postsAntes = posts().length;
  const sesionesAntes = sesionesFalsas.size;
  await consultar(e);
  assert.equal(posts().length, postsAntes);
  assert.equal(sesionesFalsas.size, sesionesAntes);
});

// ═══ Seguridad: ninguna llave en registros ni en URLs ═══
await prueba('ni la llave de Mux ni la del Hub aparecen en los registros del servidor ni en las URLs que se le pidieron a Talks', () => {
  const secretos = [LLAVE_DEL_HUB, 'otra-llave-que-no-es', 'llave_con_guion_bajo', ...llavesMux];
  assert.ok(registros.length > 0, 'la prueba no capturó ningún registro (¿se rompió la captura?)');
  for (const s of secretos) {
    assert.ok(!registros.some((r) => r.includes(s)), `«${s}» salió en un registro`);
    assert.ok(!llamadasTalks.some((l) => l.url.includes(s)), `«${s}» salió en una URL`);
  }
});

servidorTalks.close();
globalThis.fetch = fetchReal;
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
