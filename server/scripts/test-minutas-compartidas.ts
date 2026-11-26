// Pruebas de las juntas en las que alguien estuvo invitado pero cuya grabación hizo OTRA persona (Notetaker / Minutas, 2026-11-26): la regla pura
// (src/lib/minutas/juntasCompartidas.ts) y el servicio completo (src/api/getMinutasOverview.ts) contra una base en memoria (PGlite, esquema real) y un Microsoft
// de mentira. Cualquier llamada a otra dirección hace fallar la prueba. Todos los datos son inventados.
// Revisa: que una junta del calendario de la persona muestre la grabación que hizo otra (mismo asunto y horario, aunque el id del evento sea otro y el asunto
// venga con «RV:»), que una grabación ajena de una junta a la que NO fue invitada no salga NI como sesión suelta, que otra hora, otra duración o un asunto
// distinto no empaten, que lo propio y lo de sus proyectos gane y no se duplique, que la respuesta no regale el texto ni el correo de quien grabó, y que si
// Microsoft falla no salga nada ajeno.
// uso: node server/node_modules/.bin/tsx server/scripts/test-minutas-compartidas.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspect } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getMinutasOverview from '../../src/api/getMinutasOverview';
import { TOLERANCIA_HORARIO_MS, empatarGrabacionesAjenas, esLaMismaJunta, normalizarAsunto } from '../../src/lib/minutas/juntasCompartidas';

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

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

// ═══ La regla pura (sin base ni red) ═══
const JUNTA = { id: 'j1', subject: 'Alineación Zafiro', start: '2026-11-24T18:00:00.000Z', end: '2026-11-24T19:00:00.000Z' };
const GRAB = { id: 'g1', subject: 'Alineación Zafiro', meetingStart: '2026-11-24T18:00:00.000Z', meetingEnd: '2026-11-24T19:00:00.000Z', hasTranscript: true, status: 'ready' };

await prueba('normalizarAsunto: sin acentos, sin mayúsculas, sin espacios de más y sin «RV:», «FW:», «RE:» (uno o varios)', () => {
  assert.equal(normalizarAsunto('  Alineación   ZAFIRO '), 'alineacion zafiro');
  assert.equal(normalizarAsunto('RV: Alineación Zafiro'), 'alineacion zafiro');
  assert.equal(normalizarAsunto('FW: RE: rv:  Alineación Zafiro'), 'alineacion zafiro');
  assert.equal(normalizarAsunto('Fwd:Alineación Zafiro'), 'alineacion zafiro');
  assert.equal(normalizarAsunto('Reenviado: Alineación Zafiro'), 'alineacion zafiro');
  assert.equal(normalizarAsunto(null), '');
  assert.equal(normalizarAsunto(undefined), '');
  // Un asunto que solo EMPIEZA parecido a un prefijo no se toca.
  assert.equal(normalizarAsunto('Revisión RAPIDITO 3'), 'revision rapidito 3');
  assert.equal(normalizarAsunto('Reunión: cierre'), 'reunion: cierre');
});

await prueba('esLaMismaJunta: mismo asunto y horario; con acentos o mayúsculas distintas y con «RV:» también', () => {
  assert.equal(esLaMismaJunta(JUNTA, GRAB), true);
  assert.equal(esLaMismaJunta({ ...JUNTA, subject: 'RV: ALINEACION ZAFIRO' }, GRAB), true);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, subject: 'alineación zafiro' }), true);
});

await prueba('esLaMismaJunta: otro asunto, aunque sea parecido, no empata', () => {
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, subject: 'Alineación Zafiro 2' }), false);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, subject: 'Zafiro' }), false);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, subject: 'Feedback Zafiro' }), false);
});

await prueba(`esLaMismaJunta: el inicio puede diferir hasta ${TOLERANCIA_HORARIO_MS / MIN} minutos, ni un minuto más`, () => {
  const inicio = new Date(JUNTA.start).getTime();
  for (const delta of [0, 1, 9, -9, 10, -10]) assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingStart: new Date(inicio + delta * MIN).toISOString(), meetingEnd: undefined }), true, `delta ${delta}`);
  for (const delta of [11, -11, 60, -240, 24 * 60]) assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingStart: new Date(inicio + delta * MIN).toISOString(), meetingEnd: undefined }), false, `delta ${delta}`);
});

await prueba('esLaMismaJunta: dos juntas con el mismo nombre que empiezan juntas pero duran distinto NO son la misma (también cuenta la hora de fin)', () => {
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingEnd: '2026-11-24T19:05:00.000Z' }), true);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingEnd: '2026-11-24T21:00:00.000Z' }), false);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingEnd: '2026-11-24T18:20:00.000Z' }), false);
});

await prueba('esLaMismaJunta: si de un lado no se sabe la hora de fin, basta con el inicio; sin hora de inicio no empata nunca', () => {
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingEnd: null }), true);
  assert.equal(esLaMismaJunta({ ...JUNTA, end: '' }, GRAB), true);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingStart: null }), false);
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingStart: 'no es una fecha' }), false);
  assert.equal(esLaMismaJunta({ ...JUNTA, start: '' }, GRAB), false);
});

await prueba('esLaMismaJunta: un asunto vacío o «Sin título» no dice nada de la junta y nunca empata', () => {
  for (const asunto of ['', '   ', 'Sin título', 'sin titulo', 'RV: Sin título']) {
    assert.equal(esLaMismaJunta({ ...JUNTA, subject: asunto }, { ...GRAB, subject: asunto }), false, JSON.stringify(asunto));
  }
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, subject: null }), false);
});

await prueba('esLaMismaJunta: acepta fechas como Date o como texto', () => {
  assert.equal(esLaMismaJunta(JUNTA, { ...GRAB, meetingStart: new Date(JUNTA.start), meetingEnd: new Date(JUNTA.end) }), true);
});

await prueba('empatarGrabacionesAjenas: cada grabación sirve para UNA sola junta, aunque dos juntas del calendario se parezcan', () => {
  const j2 = { ...JUNTA, id: 'j2' };
  const r = empatarGrabacionesAjenas([JUNTA, j2], [GRAB]);
  assert.equal(r.size, 1);
  assert.equal(r.get('j1')?.id, 'g1');
  assert.equal(r.has('j2'), false);
});

await prueba('empatarGrabacionesAjenas: si varias personas grabaron la misma junta, gana la que tiene transcripción, luego la ya procesada, luego la más cercana', () => {
  const sinTexto = { ...GRAB, id: 'a-sin-texto', hasTranscript: false };
  const conTexto = { ...GRAB, id: 'b-con-texto', hasTranscript: true, status: 'processing' };
  assert.equal(empatarGrabacionesAjenas([JUNTA], [sinTexto, conTexto]).get('j1')?.id, 'b-con-texto');
  assert.equal(empatarGrabacionesAjenas([JUNTA], [conTexto, sinTexto]).get('j1')?.id, 'b-con-texto');
  const lista = { ...GRAB, id: 'c-lista', status: 'ready' };
  const enProceso = { ...GRAB, id: 'a-en-proceso', status: 'processing' };
  assert.equal(empatarGrabacionesAjenas([JUNTA], [enProceso, lista]).get('j1')?.id, 'c-lista');
  const cerca = { ...GRAB, id: 'z-cerca', meetingStart: '2026-11-24T18:01:00.000Z' };
  const lejos = { ...GRAB, id: 'a-lejos', meetingStart: '2026-11-24T18:08:00.000Z' };
  assert.equal(empatarGrabacionesAjenas([JUNTA], [lejos, cerca]).get('j1')?.id, 'z-cerca');
});

await prueba('empatarGrabacionesAjenas: con todo igual el resultado no depende del orden en que llegan (gana el id más chico)', () => {
  const a = { ...GRAB, id: 'aaa' };
  const b = { ...GRAB, id: 'bbb' };
  assert.equal(empatarGrabacionesAjenas([JUNTA], [a, b]).get('j1')?.id, 'aaa');
  assert.equal(empatarGrabacionesAjenas([JUNTA], [b, a]).get('j1')?.id, 'aaa');
});

await prueba('empatarGrabacionesAjenas: sin juntas, sin grabaciones o sin parecido, no hay empates', () => {
  assert.equal(empatarGrabacionesAjenas([], [GRAB]).size, 0);
  assert.equal(empatarGrabacionesAjenas([JUNTA], []).size, 0);
  assert.equal(empatarGrabacionesAjenas([JUNTA], [{ ...GRAB, subject: 'Otra cosa' }]).size, 0);
});

// ═══ El servicio completo: base en memoria y Microsoft de mentira ═══
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

const YO = 'usuario@ejemplo.test';
const OTRA = 'otra.persona@ejemplo.test';
const ctx = { user: { id: 'u1', email: YO } } as any;
process.env.MS_TENANT_ID = 'tenant-de-mentira';
process.env.MS_CLIENT_ID = 'cliente-de-mentira';
process.env.MS_CLIENT_SECRET = 'secreto-de-mentira';

/** Una hora fija de un día, contado desde hoy (negativo = pasado), en UTC. */
const dia = (offsetDias: number, hora: number, minuto = 0) => { const d = new Date(Date.now() + offsetDias * DIA); d.setUTCHours(hora, minuto, 0, 0); return d; };
const horaGraph = (d: Date) => d.toISOString().slice(0, -1) + '0000';
type EventoFalso = { id: string; subject: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl: string } };
const teams = { isOnlineMeeting: true, onlineMeeting: { joinUrl: 'https://teams.ejemplo.test/l/meetup-join/abc' } };
const evento = (id: string, subject: string, inicio: Date, duracionMs = HORA): EventoFalso => ({
  id, subject, start: { dateTime: horaGraph(inicio), timeZone: 'UTC' }, end: { dateTime: horaGraph(new Date(inicio.getTime() + duracionMs)), timeZone: 'UTC' }, ...teams,
});

// Mi calendario (los ids son los de MI calendario: nunca coinciden con los del calendario de quien grabó).
const CALENDARIO: EventoFalso[] = [
  evento('mi-zafiro', 'Alineación Zafiro', dia(-2, 18)),
  evento('mi-reenviada', 'RV: Resultados Etapa Uno', dia(-3, 17)),
  evento('mi-otra-hora', 'Status semanal', dia(-1, 15)),
  evento('mi-larga', 'Weekly', dia(-4, 16), 3 * HORA),
  evento('mi-propia', 'Revisión interna', dia(-5, 14)),
  evento('mi-sin-titulo', 'Sin título', dia(-2, 20)),
  evento('mi-sin-texto', 'Kick-off de prueba', dia(-6, 16)),
  evento('mi-doble', 'Debrief doble', dia(-1, 19)),
  evento('mi-de-proyecto', 'Resultados del proyecto', dia(-3, 12)),
  evento('mi-sin-nadie', 'Junta que nadie grabó', dia(-1, 12)),
];

// El calendario de la otra persona: SU evento de la junta de Zafiro, con SU id (el mismo evento tiene un id distinto en cada calendario).
const CALENDARIOS: Record<string, EventoFalso[]> = {
  [YO]: CALENDARIO,
  [OTRA]: [evento('evento-de-otra-1', 'Alineación Zafiro', dia(-2, 18))],
};

let graphCaido = false;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://login.microsoftonline.com/')) return json({ access_token: 'token-de-mentira', expires_in: 3600 });
  if (url.startsWith('https://graph.microsoft.com/v1.0/users/') && url.includes('/calendar/calendarView?')) {
    if (graphCaido) return json({ error: { code: 'ServiceUnavailable', message: 'Microsoft de mentira caído' } }, 502);
    const u = new URL(url);
    const desde = new Date(u.searchParams.get('startDateTime')!).getTime();
    const hasta = new Date(u.searchParams.get('endDateTime')!).getTime();
    const buzon = decodeURIComponent(url.split('/users/')[1].split('/')[0]).toLowerCase();
    return json({ value: (CALENDARIOS[buzon] ?? []).filter((e) => new Date(e.start.dateTime + 'Z').getTime() < hasta && new Date(e.end.dateTime + 'Z').getTime() > desde) });
  }
  throw new Error(`La prueba intentó salir a la red: ${url}`);
}) as typeof fetch;

const TEXTO_AJENO = 'texto secreto de la junta de otra persona';
const grabacion = async (o: { dueno: string; evento?: string | null; asunto: string; inicio: Date; duracionMs?: number; texto?: string | null; estado?: string; proyecto?: string | null }) =>
  (await pg.query<{ id: string }>(
    `insert into meeting_recordings (graph_event_id, subject, owner_email, meeting_start, meeting_end, status, transcript, mux_playback_id, mux_asset_id, assembly_transcript_id, project_id)
     values ($1, $2, $3, $4, $5, $6, $7, 'pb', 'as', 'tr', $8) returning id`,
    [o.evento ?? null, o.asunto, o.dueno, o.inicio.toISOString(), new Date(o.inicio.getTime() + (o.duracionMs ?? HORA)).toISOString(), o.estado ?? 'ready',
      o.texto === undefined ? TEXTO_AJENO : o.texto, o.proyecto ?? null],
  )).rows[0].id;

// Proyecto del que soy analista (para la regla de siempre: lo vinculado a mis proyectos se ve).
const miUsuario = (await pg.query<{ id: string }>(`insert into users (email, first_name, last_name, "role") values ($1, 'Usuario', 'De Prueba', 'Analista') returning id`, [YO])).rows[0].id;
const miProyecto = (await pg.query<{ id: string }>(`insert into projects (project_code) values ('PROYECTO-MIO') returning id`)).rows[0].id;
await pg.query(`insert into projects_analistas (project_id, user_id) values ($1, $2)`, [miProyecto, miUsuario]);
const otroProyecto = (await pg.query<{ id: string }>(`insert into projects (project_code) values ('PROYECTO-AJENO') returning id`)).rows[0].id;

// Lo que otras personas grabaron (cada una con el id de evento de SU calendario).
const recZafiro = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-1', asunto: 'Alineación Zafiro', inicio: dia(-2, 18) });
const recReenviada = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-2', asunto: 'Resultados Etapa Uno', inicio: dia(-3, 17), proyecto: otroProyecto });
const recOtraHora = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-3', asunto: 'Status semanal', inicio: dia(-1, 19) });
const recLarga = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-4', asunto: 'Weekly', inicio: dia(-4, 16), duracionMs: 30 * MIN });
const recAjenaSinInvitacion = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-5', asunto: 'Junta de otro equipo', inicio: dia(-2, 16) });
const recSinTitulo = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-6', asunto: 'Sin título', inicio: dia(-2, 20) });
const recSinTexto = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-7', asunto: 'Kick-off de prueba', inicio: dia(-6, 16), texto: null, estado: 'processing' });
const recDobleSinTexto = await grabacion({ dueno: 'tercera@ejemplo.test', evento: 'evento-de-tercera', asunto: 'Debrief doble', inicio: dia(-1, 19), texto: null });
const recDobleConTexto = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-8', asunto: 'Debrief doble', inicio: dia(-1, 19) });
const recDeProyecto = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-9', asunto: 'Resultados del proyecto', inicio: dia(-3, 12), proyecto: miProyecto });
const recProyectoSinInvitacion = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-11', asunto: 'Junta del proyecto sin mí', inicio: dia(-2, 9), proyecto: miProyecto });
// Lo mío: una grabación propia de una junta que otra persona también grabó (la mía manda).
const recMia = await grabacion({ dueno: YO, evento: 'mi-propia', asunto: 'Revisión interna', inicio: dia(-5, 14) });
const recDeOtraDeLaMia = await grabacion({ dueno: OTRA, evento: 'evento-de-otra-10', asunto: 'Revisión interna', inicio: dia(-5, 14) });

const consultar = (pedido: { desde?: string; hasta?: string } = {}) => getMinutasOverview.run(pedido, ctx) as Promise<{ sessions: any[]; calendarioDisponible: boolean }>;
const sesion = (r: { sessions: any[] }, clave: string) => r.sessions.find((s) => s.key === clave);
const idsConGrabacion = (r: { sessions: any[] }) => r.sessions.filter((s) => s.recording).map((s) => s.recording.id);

await prueba('la junta del calendario muestra la grabación que hizo otra persona, aunque el id del evento sea otro', async () => {
  const r = await consultar();
  const s = sesion(r, 'cal-mi-zafiro');
  assert.ok(s, 'faltó la junta en el calendario');
  assert.equal(s.recording?.id, recZafiro);
  assert.equal(s.recording.hasTranscript, true);
  assert.equal(s.recording.status, 'ready');
  assert.equal(s.recording.muxPlaybackId, 'pb');
  assert.equal(s.recording.assemblyTranscriptId, 'tr');
});

await prueba('una invitación reenviada («RV: …») también se empata con la grabación', async () => {
  const s = sesion(await consultar(), 'cal-mi-reenviada');
  assert.equal(s.recording?.id, recReenviada);
  assert.deepEqual(s.recording.project, [otroProyecto], 'la grabación trae su proyecto (aunque no sea mío) para que el botón de vincular muestre lo que ya tiene');
});

await prueba('una grabación ajena de una junta a la que NO estaba invitado no sale: ni en el calendario ni como sesión suelta', async () => {
  const r = await consultar();
  assert.ok(!idsConGrabacion(r).includes(recAjenaSinInvitacion));
  assert.ok(!r.sessions.some((s) => s.key === `rec-${recAjenaSinInvitacion}`), 'salió como sesión suelta');
  // Ninguna grabación ajena sale suelta: solo las que calzaron con una junta de mi calendario.
  for (const ajena of [recZafiro, recReenviada, recOtraHora, recLarga, recSinTitulo, recSinTexto, recDobleSinTexto, recDobleConTexto, recDeOtraDeLaMia]) {
    assert.ok(!r.sessions.some((s) => s.key === `rec-${ajena}`), `la ajena ${ajena} salió como sesión suelta`);
  }
});

await prueba('mismo asunto pero otra hora (4 horas después): no empata', async () => {
  const r = await consultar();
  assert.equal(sesion(r, 'cal-mi-otra-hora').recording, undefined);
  assert.ok(!idsConGrabacion(r).includes(recOtraHora));
});

await prueba('mismo asunto y mismo inicio pero la otra junta dura mucho menos: no empata', async () => {
  const r = await consultar();
  assert.equal(sesion(r, 'cal-mi-larga').recording, undefined);
  assert.ok(!idsConGrabacion(r).includes(recLarga));
});

await prueba('un asunto «Sin título» nunca empata, aunque la hora sea la misma', async () => {
  const r = await consultar();
  assert.equal(sesion(r, 'cal-mi-sin-titulo').recording, undefined);
  assert.ok(!idsConGrabacion(r).includes(recSinTitulo));
});

await prueba('una junta que nadie grabó sigue «Sin grabar»', async () => {
  assert.equal(sesion(await consultar(), 'cal-mi-sin-nadie').recording, undefined);
});

await prueba('una grabación ajena todavía sin transcripción también se muestra, marcada sin texto', async () => {
  const s = sesion(await consultar(), 'cal-mi-sin-texto');
  assert.equal(s.recording?.id, recSinTexto);
  assert.equal(s.recording.hasTranscript, false);
  assert.equal(s.recording.status, 'processing');
});

await prueba('si dos personas grabaron la misma junta, sale la que tiene transcripción', async () => {
  const s = sesion(await consultar(), 'cal-mi-doble');
  assert.equal(s.recording?.id, recDobleConTexto);
  assert.equal(s.recording.hasTranscript, true);
  assert.ok(!idsConGrabacion(await consultar()).includes(recDobleSinTexto));
});

await prueba('lo propio gana: mi grabación sale en su junta y la de la otra persona de esa misma junta no se muestra', async () => {
  const r = await consultar();
  assert.equal(sesion(r, 'cal-mi-propia').recording?.id, recMia);
  assert.ok(!idsConGrabacion(r).includes(recDeOtraDeLaMia));
  assert.equal(r.sessions.filter((s) => s.recording?.id === recMia).length, 1);
});

await prueba('la grabación de un proyecto mío hecha por otra persona, de una junta a la que estaba invitado, sale UNA vez y pegada a su junta (no aparte)', async () => {
  const r = await consultar();
  const donde = r.sessions.filter((s) => s.recording?.id === recDeProyecto);
  assert.equal(donde.length, 1, 'debía salir exactamente una vez');
  assert.equal(donde[0].key, 'cal-mi-de-proyecto', 'debía salir en su junta del calendario y no como sesión suelta');
});

await prueba('lo de siempre: la grabación de un proyecto mío de una junta a la que NO estaba invitado sigue saliendo, como sesión suelta', async () => {
  const r = await consultar();
  const donde = r.sessions.filter((s) => s.recording?.id === recProyectoSinInvitacion);
  assert.equal(donde.length, 1);
  assert.equal(donde[0].key, `rec-${recProyectoSinInvitacion}`);
});

await prueba('la respuesta no regala el texto de la transcripción ni el correo de quien grabó', async () => {
  const texto = JSON.stringify(await consultar());
  assert.ok(!texto.includes(TEXTO_AJENO), 'viajó el texto de la transcripción');
  assert.ok(!texto.includes(OTRA), 'viajó el correo de quien grabó');
  assert.ok(!texto.includes('tercera@ejemplo.test'));
});

await prueba('si Microsoft falla no sale nada ajeno: sin calendario no hay juntas con las que empatar', async () => {
  graphCaido = true;
  const registros: string[] = [];
  const consolaError = console.error;
  console.error = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : inspect(x))).join(' ')); };
  try {
    const r = await consultar();
    assert.equal(r.calendarioDisponible, false);
    for (const ajena of [recZafiro, recReenviada, recSinTexto, recDobleConTexto, recAjenaSinInvitacion]) assert.ok(!idsConGrabacion(r).includes(ajena), `salió la ajena ${ajena}`);
  } finally { console.error = consolaError; graphCaido = false; }
  assert.equal((await consultar()).calendarioDisponible, true);
});

await prueba('con una semana pedida (rango personalizado) también se empata', async () => {
  const pedido = { desde: dia(-8, 6).toISOString(), hasta: dia(0, 6).toISOString() };
  const r = await consultar(pedido);
  assert.equal(sesion(r, 'cal-mi-zafiro').recording?.id, recZafiro);
  assert.equal(sesion(r, 'cal-mi-sin-texto').recording?.id, recSinTexto);
});

await prueba('una grabación ajena de otra semana no se cuela en una semana donde no hay junta que la reclame', async () => {
  const lejos = { desde: dia(-30, 6).toISOString(), hasta: dia(-23, 6).toISOString() };
  const r = await consultar(lejos);
  assert.ok(!r.sessions.some((s) => s.key.startsWith('cal-')), 'no hay juntas en esa semana');
  // Solo salen las de siempre (propias y de mis proyectos, como sesiones sueltas): ninguna de las ajenas que no son de mis proyectos.
  for (const ajena of [recZafiro, recReenviada, recOtraHora, recLarga, recAjenaSinInvitacion, recSinTitulo, recSinTexto, recDobleSinTexto, recDobleConTexto, recDeOtraDeLaMia]) {
    assert.ok(!idsConGrabacion(r).includes(ajena), `salió la ajena ${ajena}`);
  }
});

await prueba('lo de siempre: otra persona que consulta NO recibe mis grabaciones propias, y yo no recibo las suyas si no estuve en su junta', async () => {
  const otraCtx = { user: { id: 'u2', email: OTRA } } as any;
  // Su calendario falso solo tiene SU evento de la junta de Zafiro: sus grabaciones salen a su nombre y lo mío (recMia) no se le cuela.
  const r = await getMinutasOverview.run({}, otraCtx) as any;
  assert.ok(!idsConGrabacion(r).includes(recMia), 'a la otra persona le salió una grabación mía que nada tiene que ver con sus juntas');
  assert.ok(idsConGrabacion(r).includes(recZafiro), 'sus propias grabaciones deben salir');
  assert.equal(r.sessions.find((s: any) => s.key === 'cal-evento-de-otra-1')?.recording?.id, recZafiro, 'su grabación se pega a su junta por su id de evento');
});

await prueba('quien SÍ estaba invitado a la junta de Zafiro pero no la grabó ve la grabación, y quien la grabó sigue viéndola en la suya (sin duplicarse en el calendario de cada quien)', async () => {
  const mia = await consultar();
  const suya = await getMinutasOverview.run({}, { user: { id: 'u2', email: OTRA } } as any) as any;
  assert.equal(mia.sessions.filter((s: any) => s.recording?.id === recZafiro).length, 1);
  assert.equal(suya.sessions.filter((s: any) => s.recording?.id === recZafiro).length, 1);
});

globalThis.fetch = fetchReal;
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
