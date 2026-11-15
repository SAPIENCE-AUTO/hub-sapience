// Pruebas del botón «Crear links de sesión» en la FILA de cada evento de la lista del calendario (components/pm/TalksFilaCell.tsx, columna «Talks» de EventsTable.tsx),
// sin tocar nada real: una base en memoria (PGlite) con el esquema real, un Talks de mentira y un Mux de mentira; cualquier llamada a otra dirección hace fallar la prueba.
// Revisa: que la lista del calendario (getTasks) traiga los datos de Talks de TODOS los eventos en una sola consulta (sin preguntar evento por evento ni hablarle a Talks)
// y sin la llave de transmisión de Mux; que no rompa lo de Zoom que ya traía ni la carga si faltan las columnas de Talks; que lo que se crea desde la fila lo vea la ventana del
// evento y al revés, sin crear nada doble (ni con dos clics a la vez); la lógica que comparten los dos lugares (qué sabe la fila de un evento, el almacén que se pasan);
// y cómo se dibuja la celda en cada caso (sin links, creando, con links, sin link de observación).
// uso: node server/node_modules/.bin/tsx server/scripts/test-talks-fila.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import createTalksSession from '../../src/api/createTalksSession';
import getTalksSession from '../../src/api/getTalksSession';
import getTasks from '../../src/api/getTasks';
import { leerTalksDeEventos, urlDeObservacion } from '../../src/serverUtils/talksSession';
import { esEventoGuardado, linksDeTalks, motivoDeError, talksDeEvento, talksParaFila } from '../../src/lib/talksSesion';
import { olvidarTalksCompartido, publicarTalks, suscribirTalks, talksCompartido } from '../../src/lib/talksCompartido';
import { TalksFilaVista } from '../../src/components/pm/TalksFilaVista';

// ─── Registros: lo que los endpoints escriben en consola se guarda aparte (para contar avisos y revisar que no se filtró ninguna llave) ───
const registros: string[] = [];
let nivelBitacora = 0;
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

// ─── Base en memoria con el esquema real; observation_sessions ya con las columnas de Talks (su migración se prueba en test-talks.ts) ───
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const consultas: string[] = []; // cada consulta que llega a la base, para contar cuántas hace la lista
const q = async (sql: string, params?: unknown[]) => {
  consultas.push(sql);
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
await pg.exec(`
  create table observation_sessions (
    id uuid primary key default gen_random_uuid(),
    calendar_event_id uuid references calendar_events(id) on delete set null,
    slug text unique not null,
    nombre text, cliente text,
    mux_live_stream_id text, mux_stream_key text, mux_playback_id text, mux_asset_id text,
    estado text not null default 'borrador',
    zoom_meeting_id text, zoom_join_url text, zoom_start_url text, zoom_host_email text, zoom_needs_update boolean,
    talks_session_id text, talks_link_equipo text, talks_link_participantes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
await pg.query(`insert into projects (project_code, status, client) values ('P-UNO', 'En curso', 'Cliente de Prueba')`);

const evento = async (nombre: string) =>
  (await pg.query<{ id: string }>(`insert into calendar_events (event_name, project_code, calendar_name) values ($1, 'P-UNO', 'Cal') returning id`, [nombre])).rows[0].id;
const LLAVE_MUX_SECRETA = 'mux-llave-secreta-de-la-lista-7788';
let secuenciaSala = 0;
/** Una sala puesta a mano (como la dejaría «Crear stream» o «Crear links de sesión»), con o sin Talks, con o sin Zoom. */
async function sala(eventoId: string, o: { talks?: boolean; zoom?: boolean; creada?: string } = {}) {
  secuenciaSala++;
  const slug = `evento-${String(secuenciaSala).padStart(3, '0')}-ab12cd34`;
  await pg.query(
    `insert into observation_sessions
       (calendar_event_id, slug, mux_stream_key, mux_playback_id, mux_live_stream_id, zoom_meeting_id, zoom_needs_update, talks_session_id, talks_link_equipo, talks_link_participantes, created_at)
     values ($1, $2, $3, 'pb', 'ls', $4, false, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      eventoId, slug, LLAVE_MUX_SECRETA, o.zoom ? 'z-123' : null,
      o.talks ? `ses-${secuenciaSala}` : null,
      o.talks ? `https://talks.ejemplo.test/equipo/ses-${secuenciaSala}` : null,
      o.talks ? `https://talks.ejemplo.test/p/${String(secuenciaSala).padStart(12, '0')}` : null,
      o.creada ?? null,
    ],
  );
  return slug;
}
const totalSalas = async () => Number((await pg.query<{ c: string }>(`select count(*) c from observation_sessions`)).rows[0].c);

// ─── Mux de mentira + Talks de mentira (las dos rutas del contrato) ───
let muxCreados = 0;
process.env.ZITE_MUX_TOKEN_ID = 'token-de-mentira';
process.env.ZITE_MUX_TOKEN_SECRET = 'secreto-de-mentira';
delete process.env.ZITE_ZOOM_HOST_EMAILS;
const LLAVE_DEL_HUB = 'llave-del-hub-de-mentira-9f3a';
type SesionFalsa = { id: string; nombre: string; codigo: string; externoId: string };
const sesionesFalsas = new Map<string, SesionFalsa>();
const llamadasTalks: Array<{ metodo: string; url: string }> = [];
let contadorTalks = 0;
const salidaTalks = (s: SesionFalsa, yaExistia: boolean) => ({
  id: s.id, nombre: s.nombre, codigo: s.codigo, externoId: s.externoId, yaExistia, transmision: 'lista',
  linkParticipantes: `https://talks.ejemplo.test/p/${s.codigo}`,
  linkEquipo: `https://talks.ejemplo.test/equipo/${s.id}`,
});
const servidorTalks = http.createServer(async (req, res) => {
  const trozos: Buffer[] = [];
  for await (const t of req) trozos.push(t as Buffer);
  let cuerpo: any;
  try { cuerpo = JSON.parse(Buffer.concat(trozos).toString('utf8')); } catch { cuerpo = undefined; }
  llamadasTalks.push({ metodo: req.method ?? '', url: req.url ?? '' });
  const json = (status: number, obj: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== `Bearer ${LLAVE_DEL_HUB}`) return json(401, { error: 'llave inválida' });
  const url = new URL(req.url ?? '/', 'http://talks.local');
  if (req.method === 'POST' && url.pathname === '/api/v1/sesiones') {
    let s = sesionesFalsas.get(cuerpo.externoId);
    const yaExistia = !!s;
    if (s) s.nombre = cuerpo.nombre;
    else {
      contadorTalks++;
      s = { id: `t${contadorTalks}xyz`, nombre: cuerpo.nombre, codigo: String(contadorTalks).padStart(12, '0'), externoId: cuerpo.externoId };
      sesionesFalsas.set(cuerpo.externoId, s);
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

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.mux.com/')) {
    await new Promise((r) => setTimeout(r, 30)); // lo bastante lento para que dos clics a la vez se encimen de verdad
    muxCreados++;
    return new Response(
      JSON.stringify({ data: { id: `ls-${muxCreados}`, stream_key: `mux-llave-${String(muxCreados).padStart(3, '0')}-abcd-efgh`, playback_ids: [{ id: `pb-${muxCreados}`, policy: 'public' }] } }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (url.startsWith('http://127.0.0.1:')) return fetchReal(input, init);
  throw new Error(`La prueba intentó salir a la red: ${url}`);
}) as typeof fetch;

process.env.TALKS_URL = TALKS_BASE;
process.env.TALKS_API_KEY = LLAVE_DEL_HUB;
process.env.ZITE_APP_URL = 'https://hub.ejemplo.test';

const ctx = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
const crear = (id: string) => conBitacora(() => createTalksSession.run({ calendarEventId: id }, ctx)) as Promise<any>;
const consultar = (id: string) => conBitacora(() => getTalksSession.run({ calendarEventId: id }, ctx)) as Promise<any>;
/** Lo que carga la lista del calendario: por el camino rápido (solo eventos, el que usa PMPage al recargar) o el completo. */
const lista = (completa = false) =>
  conBitacora(() => getTasks.run(completa ? { projectCode: 'P-UNO' } : { projectCode: 'P-UNO', only: 'events' }, ctx)) as Promise<any>;
const delLista = async (id: string, completa = false) => (await lista(completa)).calendarEvents.find((e: any) => e.id === id);
const CAMPOS_TALKS = ['talksSessionId', 'talksLinkEquipo', 'talksLinkParticipantes', 'observationUrl'];

// ═══ Servidor: la lista del calendario trae los datos de Talks ═══
const eConTalks = await evento('Sesión con Talks');
const eSoloSala = await evento('Sesión con sala y Zoom, sin Talks');
const eSinSala = await evento('Sesión sin sala');
const slugConTalks = await sala(eConTalks, { talks: true });
await sala(eSoloSala, { zoom: true });

await prueba('la lista trae los datos de Talks de los eventos que ya tienen links, y nada en los que no', async () => {
  const a = await delLista(eConTalks);
  assert.ok(a, 'el evento con Talks no salió en la lista');
  assert.match(a.talksSessionId, /^ses-/);
  assert.match(a.talksLinkEquipo, /^https:\/\/talks\.ejemplo\.test\/equipo\//);
  assert.match(a.talksLinkParticipantes, /^https:\/\/talks\.ejemplo\.test\/p\//);
  assert.equal(a.observationUrl, `https://hub.ejemplo.test/s/${slugConTalks}`);
  for (const sinTalks of [eSoloSala, eSinSala]) {
    const e = await delLista(sinTalks);
    for (const c of CAMPOS_TALKS) assert.ok(!(c in e), `«${c}» no debía venir en un evento sin links de Talks`);
  }
});

await prueba('lo mismo por el camino completo de la lista (sin «solo eventos»)', async () => {
  const a = await delLista(eConTalks, true);
  assert.equal(a.talksLinkEquipo, (await delLista(eConTalks)).talksLinkEquipo);
  assert.equal(a.observationUrl, `https://hub.ejemplo.test/s/${slugConTalks}`);
  const e = await delLista(eSinSala, true);
  for (const c of CAMPOS_TALKS) assert.ok(!(c in e));
});

await prueba('lo de Zoom que ya traía la lista sigue igual (hasZoom y zoomNeedsUpdate)', async () => {
  assert.equal((await delLista(eSoloSala)).hasZoom, true);
  assert.equal((await delLista(eSoloSala)).zoomNeedsUpdate, false);
  assert.equal((await delLista(eConTalks)).hasZoom, false);
  assert.equal((await delLista(eSinSala)).hasZoom, false);
  await pg.query(`update observation_sessions set zoom_needs_update = true where calendar_event_id = $1`, [eSoloSala]);
  assert.equal((await delLista(eSoloSala)).zoomNeedsUpdate, true);
  await pg.query(`update observation_sessions set zoom_needs_update = false where calendar_event_id = $1`, [eSoloSala]);
});

await prueba('la llave de transmisión de Mux no sale en la lista (ni de un evento con Talks ni de uno sin él)', async () => {
  for (const completa of [false, true]) {
    const texto = JSON.stringify(await lista(completa));
    assert.ok(!texto.includes(LLAVE_MUX_SECRETA), 'la llave de Mux salió en la respuesta de la lista');
    assert.ok(!texto.includes('mux_stream_key') && !texto.includes('muxStreamKey'));
  }
});

await prueba('con muchos eventos hace UNA sola consulta de Talks para todos, no una por fila, y no le habla a Talks', async () => {
  const muchos: string[] = [];
  for (let i = 0; i < 40; i++) {
    const e = await evento(`Evento ${i}`);
    muchos.push(e);
    if (i % 3 !== 0) await sala(e, { talks: true }); // 26 con Talks, 14 sin sala
  }
  for (const completa of [false, true]) {
    consultas.length = 0;
    const llamadasAntes = llamadasTalks.length;
    const r = await lista(completa);
    const deTalks = consultas.filter((s) => /talks_session_id/.test(s));
    assert.equal(deTalks.length, 1, `se esperaba una consulta de Talks y hubo ${deTalks.length}`);
    assert.equal(llamadasTalks.length, llamadasAntes, 'la lista le habló a Talks');
    const conLinks = r.calendarEvents.filter((e: any) => muchos.includes(e.id) && e.talksLinkEquipo).length;
    assert.equal(conLinks, muchos.filter((_, i) => i % 3 !== 0).length);
  }
});

await prueba('el link de observación de la lista usa la misma dirección que la Sala: la primera de ZITE_APP_URL, o localhost si no hay', async () => {
  const antes = process.env.ZITE_APP_URL;
  try {
    process.env.ZITE_APP_URL = ' https://uno.ejemplo.test , https://dos.ejemplo.test';
    assert.equal((await delLista(eConTalks)).observationUrl, `https://uno.ejemplo.test/s/${slugConTalks}`);
    delete process.env.ZITE_APP_URL;
    assert.equal((await delLista(eConTalks)).observationUrl, `http://localhost:5173/s/${slugConTalks}`);
    assert.equal(urlDeObservacion('x-1'), 'http://localhost:5173/s/x-1');
  } finally { process.env.ZITE_APP_URL = antes; }
});

await prueba('con más de una sala por evento vale la primera (igual que la ventana del evento): sin importar cuál traiga Talks', async () => {
  const primeraSinTalks = await evento('Dos salas: la primera sin Talks');
  await sala(primeraSinTalks, { creada: '2026-01-01T10:00:00Z' });
  await sala(primeraSinTalks, { talks: true, creada: '2026-01-02T10:00:00Z' });
  const e1 = await delLista(primeraSinTalks);
  assert.ok(!('talksLinkEquipo' in e1), 'tomó la segunda sala, no la primera');

  const primeraConTalks = await evento('Dos salas: la primera con Talks');
  const slugPrimera = await sala(primeraConTalks, { talks: true, creada: '2026-01-01T10:00:00Z' });
  await sala(primeraConTalks, { creada: '2026-01-02T10:00:00Z' });
  const e2 = await delLista(primeraConTalks);
  assert.equal(e2.observationUrl, `https://hub.ejemplo.test/s/${slugPrimera}`);
  assert.equal((await consultar(primeraConTalks)).observationUrl, e2.observationUrl, 'la ventana y la fila muestran salas distintas');
});

await prueba('una lista vacía no hace consulta de Talks', async () => {
  consultas.length = 0;
  assert.equal((await leerTalksDeEventos([])).size, 0);
  assert.equal(consultas.length, 0);
});

// ═══ La fila y la ventana del evento: lo que crea una lo ve la otra, sin crear nada doble ═══
const eFila = await evento('Creado desde la fila');
let creadoEnFila: any;
await prueba('crear desde la fila: la lista y la ventana (getTalksSession) muestran los mismos links, incluido el de observación', async () => {
  muxCreados = 0;
  creadoEnFila = await crear(eFila);
  assert.equal(creadoEnFila.yaExistia, false);
  assert.match(creadoEnFila.observationUrl, /^https:\/\/hub\.ejemplo\.test\/s\/.+/);
  const fila = await delLista(eFila);
  assert.equal(fila.talksSessionId, creadoEnFila.talksSessionId);
  assert.equal(fila.talksLinkEquipo, creadoEnFila.linkEquipo);
  assert.equal(fila.talksLinkParticipantes, creadoEnFila.linkParticipantes);
  assert.equal(fila.observationUrl, creadoEnFila.observationUrl);
  const ventana = await consultar(eFila);
  assert.equal(ventana.existe, true);
  assert.equal(ventana.linkEquipo, fila.talksLinkEquipo);
  assert.equal(ventana.linkParticipantes, fila.talksLinkParticipantes);
  assert.equal(ventana.observationUrl, fila.observationUrl);
});

await prueba('apretar otra vez desde el otro lugar recupera lo mismo y no crea nada doble (ni en Mux, ni en Talks, ni en la base)', async () => {
  const salasAntes = await totalSalas();
  const sesionesAntes = sesionesFalsas.size;
  const mux = muxCreados;
  const otra = await crear(eFila);
  assert.equal(otra.yaExistia, true);
  assert.equal(otra.talksSessionId, creadoEnFila.talksSessionId);
  assert.equal(otra.linkEquipo, creadoEnFila.linkEquipo);
  assert.equal(otra.observationUrl, creadoEnFila.observationUrl);
  assert.equal(await totalSalas(), salasAntes);
  assert.equal(sesionesFalsas.size, sesionesAntes);
  assert.equal(muxCreados, mux);
  assert.equal((await delLista(eFila)).talksLinkEquipo, creadoEnFila.linkEquipo);
});

await prueba('dos clics a la vez desde la fila: una sola transmisión de Mux, una sola sesión en Talks, una sola sala', async () => {
  const e = await evento('Doble clic en la fila');
  const mux = muxCreados;
  const sesiones = sesionesFalsas.size;
  const [a, b] = await Promise.all([crear(e), crear(e)]);
  assert.equal(a.talksSessionId, b.talksSessionId);
  assert.equal(a.observationUrl, b.observationUrl);
  assert.equal(muxCreados, mux + 1);
  assert.equal(sesionesFalsas.size, sesiones + 1);
  assert.equal(Number((await pg.query<{ c: string }>(`select count(*) c from observation_sessions where calendar_event_id = $1`, [e])).rows[0].c), 1);
  const f = await delLista(e);
  assert.equal(f.talksSessionId, a.talksSessionId);
});

await prueba('una fila que no sabía de los links (lista desactualizada) y aprieta el botón no duplica nada: recibe los que ya existían', async () => {
  const e = await evento('Lista desactualizada');
  const creada = await crear(e); // alguien más lo creó (otra pestaña, la ventana del evento)
  const mux = muxCreados;
  const sesiones = sesionesFalsas.size;
  const desdeLaFila = await crear(e); // la fila, que todavía mostraba «Crear links de sesión»
  assert.equal(desdeLaFila.yaExistia, true);
  assert.equal(desdeLaFila.linkEquipo, creada.linkEquipo);
  assert.equal(muxCreados, mux);
  assert.equal(sesionesFalsas.size, sesiones);
});

// ═══ La lista nunca deja de cargar por lo de Talks ═══
await prueba('si faltan las columnas de Talks (no se corrió la migración) la lista carga igual, sin los datos de Talks, y avisa una sola vez', async () => {
  for (const c of ['talks_session_id', 'talks_link_equipo', 'talks_link_participantes']) await pg.exec(`alter table observation_sessions rename column ${c} to ${c}_x`);
  try {
    registros.length = 0;
    const primera = await lista();
    const segunda = await lista(true);
    for (const r of [primera, segunda]) {
      assert.ok(r.calendarEvents.length > 40, 'la lista no cargó sus eventos');
      for (const e of r.calendarEvents) for (const c of CAMPOS_TALKS) assert.ok(!(c in e));
    }
    assert.equal(registros.filter((l) => l.includes('no se pudieron leer los datos de Talks')).length, 1, 'el aviso debía salir una sola vez');
    assert.equal((await delLista(eSoloSala)).hasZoom, true, 'lo de Zoom debía seguir funcionando');
  } finally {
    for (const c of ['talks_session_id', 'talks_link_equipo', 'talks_link_participantes']) await pg.exec(`alter table observation_sessions rename column ${c}_x to ${c}`);
  }
  assert.equal((await delLista(eConTalks)).talksSessionId.startsWith('ses-'), true, 'al volver las columnas, volvieron los datos');
});

// ═══ Lo que comparten los dos lugares (sin React) ═══
await prueba('qué sabe la fila de un evento: los tres datos completos o nada; el link de observación es opcional', () => {
  const ev = { talksSessionId: 's1', talksLinkEquipo: 'https://t.test/e', talksLinkParticipantes: 'https://t.test/p', observationUrl: 'https://h.test/s/x' };
  assert.deepEqual(talksDeEvento(ev), { talksSessionId: 's1', linkEquipo: 'https://t.test/e', linkParticipantes: 'https://t.test/p', observationUrl: 'https://h.test/s/x' });
  assert.equal(talksDeEvento({ ...ev, observationUrl: undefined })?.observationUrl, undefined);
  assert.equal(talksDeEvento({ ...ev, observationUrl: '  ' })?.observationUrl, undefined);
  for (const campo of ['talksSessionId', 'talksLinkEquipo', 'talksLinkParticipantes']) {
    for (const malo of [undefined, null, '', '   ', 5, {}]) assert.equal(talksDeEvento({ ...ev, [campo]: malo } as any), undefined, `${campo} = ${inspect(malo)}`);
  }
  assert.equal(talksDeEvento(undefined), undefined);
  assert.equal(talksDeEvento(null), undefined);
  assert.equal(talksDeEvento({}), undefined);
});

await prueba('lo que muestra la fila: lo recién creado o consultado aquí gana; lo que trajo la lista completa lo que falte', () => {
  const ev = { talksSessionId: 's1', talksLinkEquipo: 'https://t.test/e1', talksLinkParticipantes: 'https://t.test/p1', observationUrl: 'https://h.test/s/x' };
  const nuevo = { talksSessionId: 's2', linkEquipo: 'https://t.test/e2', linkParticipantes: 'https://t.test/p2' };
  assert.equal(talksParaFila({}, undefined), undefined);
  assert.equal(talksParaFila(ev, undefined)?.talksSessionId, 's1');
  assert.deepEqual(talksParaFila({}, nuevo), nuevo);
  const ambos = talksParaFila(ev, nuevo)!;
  assert.equal(ambos.talksSessionId, 's2');
  assert.equal(ambos.linkEquipo, 'https://t.test/e2');
  assert.equal(ambos.observationUrl, 'https://h.test/s/x', 'faltaba el link de observación y la lista lo tenía');
  assert.equal(talksParaFila(ev, { ...nuevo, observationUrl: 'https://h.test/s/y' })!.observationUrl, 'https://h.test/s/y');
});

await prueba('el almacén que se pasan la fila y la ventana: avisa una vez por cambio real, no por repetir lo mismo, y cada evento va aparte', () => {
  olvidarTalksCompartido();
  const sesion = { talksSessionId: 's1', linkEquipo: 'https://t.test/e', linkParticipantes: 'https://t.test/p', observationUrl: 'https://h.test/s/x' };
  let avisos = 0;
  const dejar = suscribirTalks(() => { avisos++; });
  assert.equal(talksCompartido('A'), undefined);
  publicarTalks('A', sesion);
  assert.equal(avisos, 1);
  assert.deepEqual(talksCompartido('A'), sesion);
  publicarTalks('A', { ...sesion });
  assert.equal(avisos, 1, 'publicar lo mismo no debe avisar');
  publicarTalks('A', { ...sesion, linkEquipo: 'https://t.test/otro' });
  assert.equal(avisos, 2);
  publicarTalks('A', { talksSessionId: 's1', linkEquipo: 'https://t.test/otro', linkParticipantes: 'https://t.test/p' });
  assert.equal(talksCompartido('A')?.observationUrl, 'https://h.test/s/x', 'conserva el link de observación que ya tenía');
  assert.equal(avisos, 2, 'sin cambios reales no avisa');
  publicarTalks('A', { ...sesion, transmision: 'sin-llave' });
  assert.equal(avisos, 3);
  assert.equal(talksCompartido('B'), undefined);
  publicarTalks('B', sesion);
  assert.equal(avisos, 4);
  assert.equal(talksCompartido('A')?.linkEquipo, 'https://t.test/e');
  dejar();
  publicarTalks('B', { ...sesion, linkEquipo: 'https://t.test/b2' });
  assert.equal(avisos, 4, 'después de dejar de escuchar no debe avisar');
  olvidarTalksCompartido();
});

await prueba('un evento recién escrito (id provisional «temp-...») todavía no es un evento guardado', () => {
  assert.equal(esEventoGuardado(`temp-${Date.now()}`), false);
  assert.equal(esEventoGuardado(eConTalks), true);
});

await prueba('los links de la fila: participantes y moderador (los dos de Talks) y, si se conoce, observación; en ese orden', () => {
  const base = { talksSessionId: 's1', linkEquipo: 'https://t.test/equipo', linkParticipantes: 'https://t.test/p' };
  assert.deepEqual(linksDeTalks({ ...base, observationUrl: 'https://h.test/s/x' }), [
    { etiqueta: 'Participantes', nombre: 'Link de participantes', valor: 'https://t.test/p' },
    { etiqueta: 'Moderador', nombre: 'Link del moderador', valor: 'https://t.test/equipo' },
    { etiqueta: 'Observación', nombre: 'Link de observación', valor: 'https://h.test/s/x' },
  ]);
  assert.deepEqual(linksDeTalks(base).map((l) => l.etiqueta), ['Participantes', 'Moderador']);
  assert.deepEqual(linksDeTalks({ ...base, observationUrl: '' }).map((l) => l.etiqueta), ['Participantes', 'Moderador']);
});

await prueba('el motivo de un fallo: la frase del servidor si viene en español llano; si no, una genérica', () => {
  const api = (mensaje: string) => Object.assign(new Error(mensaje), { name: 'ApiError', status: 500 });
  const generico = 'No se pudieron crear los links.';
  assert.equal(motivoDeError(api('Talks todavía no está conectado al Hub.'), generico), 'Talks todavía no está conectado al Hub.');
  assert.equal(motivoDeError(api('Error interno'), generico), generico);
  assert.equal(motivoDeError(api('createTalksSession falló (500)'), generico), generico);
  assert.equal(motivoDeError(api(''), generico), generico);
  assert.equal(motivoDeError(new Error('Failed to fetch'), generico), generico);
  assert.equal(motivoDeError('texto suelto', generico), generico);
  assert.equal(motivoDeError(undefined, generico), generico);
});

// ═══ Cómo se dibuja la celda en cada caso (TalksFilaVista: solo dibuja; la lógica de crear está en TalksFilaCell) ═══
const celda = (talks: Parameters<typeof talksParaFila>[1], creando = false) =>
  renderToStaticMarkup(createElement(TalksFilaVista, { talks, creando, onCrear: () => {} }));
const evFilaConTalks = { id: eConTalks, talksSessionId: 's1', talksLinkEquipo: 'https://talks.ejemplo.test/equipo/s1', talksLinkParticipantes: 'https://talks.ejemplo.test/p/000000000001', observationUrl: 'https://hub.ejemplo.test/s/evento-x' };

await prueba('celda: sin links muestra «Crear links de sesión» (y nada más)', () => {
  const html = celda(undefined);
  assert.match(html, /Crear links de sesión/);
  for (const sobra of ['Abrir en Talks', 'Participantes', 'Moderador', 'Observación']) assert.ok(!html.includes(sobra), `«${sobra}» no debía aparecer sin links`);
  assert.match(html, /<button[^>]*type="button"/);
  assert.ok(!/\sdisabled=""/.test(html), 'el botón no debía estar apagado'); // ojo: la clase del botón ya trae «disabled:...», se busca el atributo
  assert.match(html, /title="Crea la transmisión de Mux y la sesión en Talks\. Si ya existen, no se duplican\."/);
});

await prueba('celda: mientras se crea, el botón dice «Creando...» y está apagado (no se aprieta dos veces)', () => {
  const html = celda(undefined, true);
  assert.match(html, /Creando\.\.\./);
  assert.ok(!html.includes('Crear links de sesión'));
  assert.match(html, /<button[^>]*\sdisabled=""/);
});

await prueba('celda: con links muestra «Abrir en Talks» (link del moderador) y los tres links con botón de copiar, y ya no ofrece crear', () => {
  const html = celda(talksDeEvento(evFilaConTalks));
  assert.ok(!html.includes('Crear links de sesión'));
  assert.match(html, /<a [^>]*href="https:\/\/talks\.ejemplo\.test\/equipo\/s1"[^>]*>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Abrir en Talks/);
  for (const [etiqueta, aria, url] of [
    ['Participantes', 'Copiar link de participantes', 'https://talks.ejemplo.test/p/000000000001'],
    ['Moderador', 'Copiar link del moderador', 'https://talks.ejemplo.test/equipo/s1'],
    ['Observación', 'Copiar link de observación', 'https://hub.ejemplo.test/s/evento-x'],
  ]) {
    assert.ok(html.includes(etiqueta), `falta «${etiqueta}»`);
    assert.ok(html.includes(`aria-label="${aria}"`), `falta el botón «${aria}»`);
    assert.ok(html.includes(url), `falta el link ${url} en el título del botón`);
  }
  assert.equal((html.match(/aria-label="Copiar /g) ?? []).length, 3, 'deben ser exactamente tres botones de copiar');
});

await prueba('celda: sin link de observación (no vino) muestra solo los dos de Talks', () => {
  const html = celda(talksDeEvento({ ...evFilaConTalks, observationUrl: undefined }));
  assert.ok(html.includes('Participantes') && html.includes('Moderador'));
  assert.ok(!html.includes('Observación'));
  assert.equal((html.match(/aria-label="Copiar /g) ?? []).length, 2);
});

await prueba('celda: lo que la ventana del evento acaba de crear aparece en la fila sin recargar la lista, y vale más que lo que traía la lista', () => {
  olvidarTalksCompartido();
  const sinDatos = { id: eSinSala };
  assert.match(celda(talksParaFila(sinDatos, talksCompartido(eSinSala))), /Crear links de sesión/);
  publicarTalks(eSinSala, { talksSessionId: 's9', linkEquipo: 'https://talks.ejemplo.test/equipo/s9', linkParticipantes: 'https://talks.ejemplo.test/p/000000000009', observationUrl: 'https://hub.ejemplo.test/s/nueva' });
  const html = celda(talksParaFila(sinDatos, talksCompartido(eSinSala)));
  assert.ok(!html.includes('Crear links de sesión'));
  assert.ok(html.includes('https://talks.ejemplo.test/equipo/s9') && html.includes('https://hub.ejemplo.test/s/nueva'));
  // Un evento que la lista ya traía con otros links: gana lo recién publicado, sin perder el link de observación que traía la lista.
  publicarTalks(eConTalks, { talksSessionId: 's10', linkEquipo: 'https://talks.ejemplo.test/equipo/s10', linkParticipantes: 'https://talks.ejemplo.test/p/000000000010' });
  const html2 = celda(talksParaFila(evFilaConTalks, talksCompartido(eConTalks)));
  assert.ok(html2.includes('https://talks.ejemplo.test/equipo/s10') && !html2.includes('https://talks.ejemplo.test/equipo/s1"'));
  assert.ok(html2.includes('https://hub.ejemplo.test/s/evento-x'));
  olvidarTalksCompartido();
});

await prueba('la celda no menciona ninguna llave de transmisión: ni en lo que recibe ni en lo que dibuja', () => {
  const html = celda(talksDeEvento(evFilaConTalks));
  assert.ok(!/stream|llave|key/i.test(html.replace(/hub\.ejemplo\.test/g, '')));
});

// ═══ Que ninguna llave se haya filtrado a los registros ═══
await prueba('ni la llave de Mux ni la del Hub aparecen en los registros del servidor', () => {
  const secretos = [LLAVE_DEL_HUB, LLAVE_MUX_SECRETA];
  for (const s of secretos) assert.ok(!registros.some((r) => r.includes(s)), `«${s}» salió en un registro`);
});

servidorTalks.close();
globalThis.fetch = fetchReal;
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
