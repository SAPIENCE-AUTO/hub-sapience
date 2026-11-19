// Pruebas de qué parte del calendario de Outlook trae el Notetaker (Minutas): la regla del rango (src/lib/minutas/rangoCalendario.ts) y el servicio completo
// (src/api/getMinutasOverview.ts) contra una base en memoria (PGlite, esquema real) y un Microsoft de mentira que, como el de verdad, solo devuelve las
// juntas que caen dentro del rango pedido. Cualquier llamada a otra dirección hace fallar la prueba. Todos los datos son inventados.
// Revisa: que sin rango se pida la ventana de siempre (7 días atrás, 2 semanas adelante) y con rango exactamente esa semana, que una semana fuera de la
// ventana ya no salga vacía (el caso de la semana del 2 al 8 de noviembre vista el día 16), que una falla de Microsoft se avise en vez de mostrarse como
// «no hubo juntas», que un rango inválido se rechace sin llamar a Microsoft, y que lo de siempre siga igual (sin liga de Teams o Zoom no sale, canceladas no
// salen, la grabación se pega a su junta por el id del evento, las grabaciones salen sin importar el rango).
// uso: node server/node_modules/.bin/tsx server/scripts/test-minutas-rango.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspect } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getMinutasOverview from '../../src/api/getMinutasOverview';
import { DIAS_ADELANTE, DIAS_ATRAS, MAX_DIAS_POR_CONSULTA, MOTIVO_RANGO_INVALIDO, rangoDeConsulta } from '../../src/lib/minutas/rangoCalendario';

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

const DIA = 24 * 60 * 60 * 1000;

// ═══ La regla del rango (sin base ni red) ═══
const AHORA = new Date('2026-11-16T18:00:00.000Z');

await prueba('sin rango: la ventana de siempre, 7 días atrás y 2 semanas adelante, contada desde ahora', () => {
  assert.equal(DIAS_ATRAS, 7);
  assert.equal(DIAS_ADELANTE, 14);
  for (const pedido of [undefined, null, {}, { desde: undefined, hasta: undefined }, { desde: '', hasta: '' }, { desde: null, hasta: null }]) {
    const r = rangoDeConsulta(pedido as any, AHORA);
    assert.ok(r.ok, inspect(pedido));
    if (!r.ok) return;
    assert.equal(r.personalizado, false);
    assert.equal(r.desde.getTime(), AHORA.getTime() - 7 * DIA);
    assert.equal(r.hasta.getTime(), AHORA.getTime() + 14 * DIA);
  }
});

await prueba('con rango: exactamente esa semana (lunes 00:00 a lunes 00:00, hora de CDMX)', () => {
  const r = rangoDeConsulta({ desde: '2026-11-02T06:00:00.000Z', hasta: '2026-11-09T06:00:00.000Z' }, AHORA);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.personalizado, true);
  assert.equal(r.desde.toISOString(), '2026-11-02T06:00:00.000Z');
  assert.equal(r.hasta.toISOString(), '2026-11-09T06:00:00.000Z');
});

await prueba('con solo uno de los dos, o con algo ilegible: inválido, sin adivinar', () => {
  const malos: Array<{ desde?: unknown; hasta?: unknown }> = [
    { desde: '2026-11-02T06:00:00.000Z' }, { hasta: '2026-11-09T06:00:00.000Z' },
    { desde: '2026-11-02T06:00:00.000Z', hasta: '' }, { desde: 'mañana', hasta: 'pasado mañana' },
    { desde: '2026-13-45', hasta: '2026-11-09T06:00:00.000Z' }, { desde: 12345, hasta: 67890 }, { desde: {}, hasta: [] },
  ];
  for (const m of malos) {
    const r = rangoDeConsulta(m, AHORA);
    assert.equal(r.ok, false, inspect(m));
    if (!r.ok) assert.equal(r.motivo, MOTIVO_RANGO_INVALIDO);
  }
});

await prueba('desde igual o después de hasta: inválido', () => {
  assert.equal(rangoDeConsulta({ desde: '2026-11-09T06:00:00.000Z', hasta: '2026-11-09T06:00:00.000Z' }, AHORA).ok, false);
  assert.equal(rangoDeConsulta({ desde: '2026-11-09T06:00:00.000Z', hasta: '2026-11-02T06:00:00.000Z' }, AHORA).ok, false);
});

await prueba(`más de ${MAX_DIAS_POR_CONSULTA} días de golpe: inválido; justo ${MAX_DIAS_POR_CONSULTA}: válido`, () => {
  const desde = new Date('2026-10-01T06:00:00.000Z');
  assert.equal(MAX_DIAS_POR_CONSULTA, 42);
  assert.equal(rangoDeConsulta({ desde: desde.toISOString(), hasta: new Date(desde.getTime() + 42 * DIA).toISOString() }, AHORA).ok, true);
  assert.equal(rangoDeConsulta({ desde: desde.toISOString(), hasta: new Date(desde.getTime() + 42 * DIA + 1).toISOString() }, AHORA).ok, false);
  assert.equal(rangoDeConsulta({ desde: '2020-01-01T00:00:00.000Z', hasta: '2026-01-01T00:00:00.000Z' }, AHORA).ok, false);
});

await prueba('fechas absurdas (antes de 2020 o a más de 2 años) son inválidas; cualquier semana real, pasada o futura, es válida', () => {
  assert.equal(rangoDeConsulta({ desde: '2019-12-25T00:00:00.000Z', hasta: '2020-01-01T00:00:00.000Z' }, AHORA).ok, false);
  assert.equal(rangoDeConsulta({ desde: '2029-01-01T00:00:00.000Z', hasta: '2029-01-08T00:00:00.000Z' }, AHORA).ok, false);
  for (const [d, h] of [['2026-09-14T06:00:00.000Z', '2026-09-21T06:00:00.000Z'], ['2026-11-30T06:00:00.000Z', '2026-12-07T06:00:00.000Z'], ['2027-03-01T06:00:00.000Z', '2027-03-08T06:00:00.000Z']]) {
    assert.equal(rangoDeConsulta({ desde: d, hasta: h }, AHORA).ok, true, d);
  }
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
const ctx = { user: { id: 'u1', email: YO } } as any;
process.env.MS_TENANT_ID = 'tenant-de-mentira';
process.env.MS_CLIENT_ID = 'cliente-de-mentira';
process.env.MS_CLIENT_SECRET = 'secreto-de-mentira';

/** Una hora fija de un día, contado desde hoy (negativo = pasado), en UTC. */
const dia = (offsetDias: number, hora: number) => { const d = new Date(Date.now() + offsetDias * DIA); d.setUTCHours(hora, 0, 0, 0); return d; };
const horaGraph = (d: Date) => d.toISOString().slice(0, -1) + '0000'; // Graph manda "2026-11-02T19:00:00.0000000", sin zona
type EventoFalso = { id: string; subject: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl: string }; body?: { content: string }; isCancelled?: boolean };
const evento = (id: string, subject: string, inicio: Date, extra: Partial<EventoFalso> = {}): EventoFalso => ({
  id, subject, start: { dateTime: horaGraph(inicio), timeZone: 'UTC' }, end: { dateTime: horaGraph(new Date(inicio.getTime() + 3600_000)), timeZone: 'UTC' }, ...extra,
});
const teams = { isOnlineMeeting: true, onlineMeeting: { joinUrl: 'https://teams.ejemplo.test/l/meetup-join/abc' } };

// Las juntas del calendario falso: una reciente (dentro de la ventana de siempre), una a 24 días (la «semana vacía»: fuera de la ventana) y una a 40 días a futuro.
const CALENDARIO: EventoFalso[] = [
  evento('reciente', 'Junta reciente en Teams', dia(-2, 16), teams),
  evento('vieja-teams', 'Junta vieja en Teams', dia(-24, 16), teams),
  evento('vieja-zoom', 'Junta vieja en Zoom', dia(-24, 18), { body: { content: '<p>Únete: <a href="https://ejemplo.zoom.us/j/123456789?pwd=abc">liga</a></p>' } }),
  evento('vieja-sin-liga', 'Comida con alguien (sin liga)', dia(-24, 20), { isOnlineMeeting: false, body: { content: '<p>En persona</p>' } }),
  evento('vieja-cancelada', 'Junta vieja cancelada', dia(-24, 21), { ...teams, isCancelled: true }),
  evento('lejana', 'Junta dentro de mucho', dia(40, 16), teams),
];

type LlamadaGraph = { desde: Date; hasta: Date };
const llamadasGraph: LlamadaGraph[] = [];
let graphCaido = false;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://login.microsoftonline.com/')) return json({ access_token: 'token-de-mentira', expires_in: 3600 });
  if (url.startsWith('https://graph.microsoft.com/v1.0/users/') && url.includes('/calendar/calendarView?')) {
    const u = new URL(url);
    const desde = new Date(u.searchParams.get('startDateTime')!);
    const hasta = new Date(u.searchParams.get('endDateTime')!);
    llamadasGraph.push({ desde, hasta });
    if (graphCaido) return json({ error: { code: 'ServiceUnavailable', message: 'Microsoft de mentira caído' } }, 502);
    const dentro = CALENDARIO.filter((e) => {
      const ini = new Date(e.start.dateTime + 'Z').getTime();
      const fin = new Date(e.end.dateTime + 'Z').getTime();
      return ini < hasta.getTime() && fin > desde.getTime(); // como calendarView: lo que se cruza con el rango
    });
    return json({ value: dentro });
  }
  throw new Error(`La prueba intentó salir a la red: ${url}`);
}) as typeof fetch;

// Grabaciones: una pegada a la junta vieja de Teams por el id del evento, y una subida a mano (sin evento) de hace 30 días. Con texto, para que el barrido de rescate no haga nada.
const grabacion = async (o: { evento: string | null; asunto: string; inicio: Date }) =>
  (await pg.query<{ id: string }>(
    `insert into meeting_recordings (graph_event_id, subject, owner_email, meeting_start, meeting_end, status, transcript, mux_playback_id, mux_asset_id, assembly_transcript_id)
     values ($1, $2, $3, $4, $5, 'ready', 'texto de la junta', 'pb', 'as', 'tr') returning id`,
    [o.evento, o.asunto, YO, o.inicio.toISOString(), new Date(o.inicio.getTime() + 3600_000).toISOString()],
  )).rows[0].id;
const recVieja = await grabacion({ evento: 'vieja-teams', asunto: 'Junta vieja en Teams', inicio: dia(-24, 16) });
const recManual = await grabacion({ evento: null, asunto: 'Subida a mano', inicio: dia(-30, 15) });

const consultar = (pedido: { desde?: string; hasta?: string } = {}) => getMinutasOverview.run(pedido, ctx) as Promise<{ sessions: any[]; calendarioDisponible: boolean }>;
const claves = (r: { sessions: any[] }) => r.sessions.map((s) => s.key).sort();
const semanaVieja = () => ({ desde: dia(-27, 6).toISOString(), hasta: dia(-20, 6).toISOString() }); // cubre las juntas de hace 24 días

await prueba('sin rango pide a Outlook los últimos 7 días y las próximas 2 semanas', async () => {
  llamadasGraph.length = 0;
  const antes = Date.now();
  await consultar();
  const despues = Date.now();
  assert.equal(llamadasGraph.length, 1);
  const { desde, hasta } = llamadasGraph[0];
  assert.ok(desde.getTime() >= antes - 7 * DIA && desde.getTime() <= despues - 7 * DIA, 'desde ≠ ahora − 7 días');
  assert.ok(hasta.getTime() >= antes + 14 * DIA && hasta.getTime() <= despues + 14 * DIA, 'hasta ≠ ahora + 14 días');
});

await prueba('con rango pide a Outlook exactamente esa semana (y no la ventana de siempre)', async () => {
  llamadasGraph.length = 0;
  const pedido = semanaVieja();
  await consultar(pedido);
  assert.equal(llamadasGraph.length, 1);
  assert.equal(llamadasGraph[0].desde.toISOString(), pedido.desde);
  assert.equal(llamadasGraph[0].hasta.toISOString(), pedido.hasta);
});

await prueba('el caso del 16 de nov: una semana fuera de la ventana de siempre salía vacía y ahora trae sus juntas', async () => {
  const sinRango = await consultar();
  assert.ok(!claves(sinRango).includes('cal-vieja-zoom'), 'la ventana de siempre no debía traer la junta de hace 24 días');
  assert.ok(!claves(sinRango).includes('cal-vieja-teams'));
  const conRango = await consultar(semanaVieja());
  assert.ok(claves(conRango).includes('cal-vieja-zoom'), 'con la semana pedida debía salir la junta sin grabar');
  assert.ok(claves(conRango).includes('cal-vieja-teams'));
  assert.equal(conRango.calendarioDisponible, true);
});

await prueba('lo de siempre sigue igual: sin liga de Teams o Zoom no sale, las canceladas no salen, y Zoom se reconoce por la liga en el cuerpo', async () => {
  const r = await consultar(semanaVieja());
  const calendario = claves(r).filter((k) => k.startsWith('cal-'));
  assert.deepEqual(calendario, ['cal-vieja-teams', 'cal-vieja-zoom']);
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-zoom').provider, 'zoom');
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-teams').provider, 'teams');
});

await prueba('la grabación se pega a su junta por el id del evento; la junta sin grabar no trae grabación', async () => {
  const r = await consultar(semanaVieja());
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-teams').recording.id, recVieja);
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-teams').recording.hasTranscript, true);
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-zoom').recording, undefined);
});

await prueba('las grabaciones salen sin importar el rango (la subida a mano siempre aparece como su propia sesión)', async () => {
  for (const pedido of [{}, semanaVieja(), { desde: dia(40, 6).toISOString(), hasta: dia(47, 6).toISOString() }]) {
    const r = await consultar(pedido);
    assert.ok(claves(r).includes(`rec-${recManual}`), `faltó la subida a mano con ${inspect(pedido)}`);
  }
  // Sin la junta en el rango, la grabación de la junta vieja no se pierde: sale sola.
  assert.ok(claves(await consultar()).includes(`rec-${recVieja}`));
});

await prueba('cada semana trae solo lo suyo: la reciente y la lejana no se mezclan con la vieja', async () => {
  const vieja = claves(await consultar(semanaVieja())).filter((k) => k.startsWith('cal-'));
  assert.ok(!vieja.includes('cal-reciente') && !vieja.includes('cal-lejana'));
  const lejana = claves(await consultar({ desde: dia(37, 6).toISOString(), hasta: dia(44, 6).toISOString() })).filter((k) => k.startsWith('cal-'));
  assert.deepEqual(lejana, ['cal-lejana']);
  const reciente = claves(await consultar()).filter((k) => k.startsWith('cal-'));
  assert.deepEqual(reciente, ['cal-reciente']);
});

await prueba('si Microsoft falla se avisa (calendarioDisponible: false) y las grabaciones siguen saliendo, en vez de verse como «no hubo juntas»', async () => {
  graphCaido = true;
  const registros: string[] = [];
  const consolaError = console.error;
  console.error = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : inspect(x))).join(' ')); };
  try {
    const r = await consultar(semanaVieja());
    assert.equal(r.calendarioDisponible, false);
    assert.ok(claves(r).includes(`rec-${recManual}`) || claves(r).includes(`rec-${recVieja}`), 'las grabaciones debían seguir saliendo');
    assert.ok(!claves(r).some((k) => k.startsWith('cal-')));
    assert.ok(registros.some((l) => l.includes('no se pudo leer el calendario de Outlook')), 'debía quedar un registro de la falla');
  } finally { console.error = consolaError; graphCaido = false; }
  assert.equal((await consultar(semanaVieja())).calendarioDisponible, true, 'al volver Microsoft, vuelve a estar disponible');
});

await prueba('un rango inválido se rechaza con BAD_REQUEST y ni siquiera se llama a Outlook', async () => {
  const malos = [
    { desde: dia(-27, 6).toISOString() }, { desde: 'mañana', hasta: 'pasado' }, { desde: dia(-20, 6).toISOString(), hasta: dia(-27, 6).toISOString() },
    { desde: dia(-100, 6).toISOString(), hasta: dia(-20, 6).toISOString() },
  ];
  for (const m of malos) {
    llamadasGraph.length = 0;
    const err = await falla(() => consultar(m as any));
    assert.equal(err.code, 'BAD_REQUEST', inspect(m));
    assert.equal(err.message, MOTIVO_RANGO_INVALIDO);
    assert.equal(llamadasGraph.length, 0, 'no debía llamar a Outlook con un rango inválido');
  }
});

await prueba('la respuesta trae solo lo necesario para la lista: sin el texto de la transcripción', async () => {
  const r = await consultar(semanaVieja());
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('texto de la junta'), 'el texto completo de la transcripción no debía viajar en la lista');
  assert.equal(r.sessions.find((s) => s.key === 'cal-vieja-teams').recording.hasTranscript, true);
});

globalThis.fetch = fetchReal;
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
