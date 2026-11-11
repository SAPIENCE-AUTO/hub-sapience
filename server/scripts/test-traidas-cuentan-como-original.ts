// Pruebas de «una traída cuenta como su respuesta original»: la persona que se trae de un filtro anterior (traer.ts) es otra fila de respuestas con id propio, pero es la MISMA vez que
// llenó el filtro. Si no se juntaba con la original, «Por reclutador» la contaba como una respuesta repetida más (noviembre de 2026: 544 respuestas y 0 nuevas, todas traídas) y
// «Filtros llenados» sumaba uno de más. Lo puro (sin base) y de punta a punta contra una base en memoria (PGlite) con el esquema del Hub: se trae a gente de un filtro con tablero
// a otro filtro con tablero, y se mira el tablero, el historial y la estadística por reclutador. Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-traidas-cuentan-como-original.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import { buildIdentityClusters, type IdentityRow } from '../../src/lib/duplicateIdentity';
import { contarFiltrosLlenados, filtrosLlenadosDe } from '../../src/lib/filtrosLlenados';
import { esFilaDeTraida, respuestaDe } from '../../src/lib/respuestaFillout';
import { traerRespuestas } from '../../src/serverUtils/formularios/traer';
import { cargarTraidasAlTablero } from '../../src/serverUtils/formularios/traidasAlTablero';
import { mapaDeTraidas, mapaDeTraidasReciente, olvidarTraidas } from '../../src/serverUtils/formularios/traidasMapa';
import { calcularReclutadores } from '../../src/serverUtils/indicadores/reclutadores';

// Sin Ably: las cargas avisan a quien tiene el tablero abierto, y aquí no hay a quién.
delete process.env.ZITE_ABLY_API_KEY;
process.env.STRICT_OUTPUT = 'true';
const avisar = console.warn.bind(console);
console.warn = (...a: unknown[]) => { if (!String(a[0]).startsWith('[ably]')) avisar(...a); };
const vincularFormularioTablero = (await import('../../src/api/vincularFormularioTablero')).default;
const pasarFormularioAlReclutamiento = (await import('../../src/api/pasarFormularioAlReclutamiento')).default;
const badges = (await import('../../src/api/getBoardDuplicateBadges')).default;
const historial = (await import('../../src/api/searchParticipantHistory')).default;
const { getGlobalIdentityData } = await import('../../src/lib/globalIdentityCache');

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).stack : (e as Error).message.split('\n')[0]}`);
  }
}

// ── lo puro (sin base) ──────────────────────────────────────────────────────
const P = { email: 'ana@ejemplo.test', phone: '5500001111', participantName: 'Ana Prueba' };
const filaPura = (id: string, proyecto: string, respuesta: string | null, filtro = 'Filtro de prueba', extra: Partial<IdentityRow> = {}): IdentityRow => ({
  id, ...P, projectCode: proyecto, boardName: `T-${proyecto}`, sourceForm: respuesta ? `Formulario Hub · ${filtro}|${respuesta}` : undefined, ...extra,
});
const TRAIDAS = new Map([['copia-1', 'orig-1']]);

await prueba('respuestaDe: sin mapa devuelve el id de la fila; con mapa, una traída devuelve el de su original y lo demás no cambia', () => {
  const copia = filaPura('x', 'P2', 'copia-1', 'Filtro nuevo');
  assert.equal(respuestaDe(copia), 'copia-1');
  assert.equal(respuestaDe(copia, TRAIDAS), 'orig-1');
  assert.equal(respuestaDe(filaPura('y', 'P1', 'orig-1'), TRAIDAS), 'orig-1');
  assert.equal(respuestaDe(filaPura('z', 'P3', 'otra'), TRAIDAS), 'otra');
  assert.equal(respuestaDe(filaPura('w', 'P3', null), TRAIDAS), null, 'una fila sin id de respuesta sigue sin id');
});

await prueba('esFilaDeTraida: solo la copia de una traída lo es (y sin mapa, ninguna)', () => {
  assert.equal(esFilaDeTraida(filaPura('x', 'P2', 'copia-1'), TRAIDAS), true);
  assert.equal(esFilaDeTraida(filaPura('y', 'P1', 'orig-1'), TRAIDAS), false);
  assert.equal(esFilaDeTraida(filaPura('x', 'P2', 'copia-1')), false);
  assert.equal(esFilaDeTraida(filaPura('w', 'P3', null), TRAIDAS), false);
});

await prueba('contarFiltrosLlenados: una traída con su original cuenta uno (sin el mapa contaba dos); la traída sola o una respuesta distinta siguen contando', () => {
  const original = filaPura('o', 'P1', 'orig-1', 'Filtro original');
  const copia = filaPura('c', 'P2', 'copia-1', 'Filtro nuevo');
  const otra = filaPura('t', 'P3', 'otra', 'Otro filtro');
  assert.equal(contarFiltrosLlenados([original, copia]).filtrosLlenados, 2, 'así contaba antes del arreglo');
  assert.equal(contarFiltrosLlenados([original, copia], TRAIDAS).filtrosLlenados, 1);
  assert.equal(contarFiltrosLlenados([original, copia, otra], TRAIDAS).filtrosLlenados, 2);
  assert.equal(contarFiltrosLlenados([copia], TRAIDAS).filtrosLlenados, 1, 'si la original no está en ningún tablero, la traída es la única fila: una respuesta');
});

await prueba('filtrosLlenadosDe: la traída y su original salen como UNA respuesta copiada en otro tablero, con el nombre y el proyecto de la original aunque la traída sea más antigua', () => {
  const fechas: Record<string, string> = { P1: '2026-05-10', P2: '2026-03-10' }; // la traída está en un proyecto más antiguo que el de la original (caso raro)
  const original = filaPura('o', 'P1', 'orig-1', 'Filtro original');
  const copia = filaPura('c', 'P2', 'copia-1', 'Filtro nuevo');
  const lista = filtrosLlenadosDe([original, copia], (p) => fechas[p], TRAIDAS);
  assert.equal(lista.length, 1);
  assert.deepEqual([lista[0].respuestaId, lista[0].filtro, lista[0].proyecto, lista[0].copiasEn], ['orig-1', 'Filtro original', 'P1', 1]);
  assert.equal(filtrosLlenadosDe([original, copia], (p) => fechas[p]).length, 2, 'sin el mapa salían dos filtros llenados');
});

// ── la estadística por reclutador, con filas inventadas ─────────────────────
const HOY = '2026-11-11';
const PROYECTOS: Record<string, string> = { PA: '2026-05-10', PB: '2026-11-09', PC: '2026-08-10', PD: '2026-03-10' };
const projectMap = new Map(Object.entries(PROYECTOS).map(([k, v]) => [k, { client: 'Cliente Alfa', startDate: v }]));
function datosDe(filas: IdentityRow[]) {
  const globalClusters = buildIdentityClusters(filas, { mode: 'strict' });
  const rowToGlobalCluster = new Map<string, string>();
  for (const [cid, cl] of globalClusters) for (const id of cl.rowIds) rowToGlobalCluster.set(id, cid);
  return { activeRows: filas, projectMap, globalClusters, rowToGlobalCluster };
}
const nombresDe = (filas: IdentityRow[], nombre = 'Recluta Uno') => new Map(filas.map((f) => [f.id, nombre]));
const clave = 'recluta uno';
const mesesDe = (calculo: ReturnType<typeof calcularReclutadores>) => Object.keys(calculo.escrituras.find((e) => e.clave === clave)!.meses!).sort();
const totalDe = (calculo: ReturnType<typeof calcularReclutadores>) => calculo.escrituras.find((e) => e.clave === clave)!.c.todo;

await prueba('por reclutador: la traída se junta con su original: una respuesta, en el mes de la original (sin el mapa eran dos, una de ellas «repetida» en el mes de la traída)', () => {
  const filas = [filaPura('o', 'PA', 'orig-1', 'Filtro original'), filaPura('c', 'PB', 'copia-1', 'Filtro nuevo')];
  const sin = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY);
  assert.deepEqual([totalDe(sin)[0], totalDe(sin)[1], totalDe(sin)[2]], [2, 1, 1], 'antes: una nueva y una repetida con 1 proyecto antes');
  assert.deepEqual(mesesDe(sin), ['2026-05', '2026-11']);
  const con = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY, new Map([['copia-1', 'orig-1']]));
  assert.deepEqual([totalDe(con)[0], totalDe(con)[1], totalDe(con)[2]], [1, 1, 0]);
  assert.deepEqual(mesesDe(con), ['2026-05']);
});

await prueba('por reclutador: si la traída está en un proyecto MÁS antiguo que su original, la respuesta se ubica donde está la original (donde se recibió)', () => {
  const filas = [filaPura('o', 'PA', 'orig-1', 'Filtro original'), filaPura('c', 'PD', 'copia-1', 'Filtro nuevo')]; // PD (marzo) es anterior a PA (mayo)
  const con = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY, new Map([['copia-1', 'orig-1']]));
  assert.deepEqual(mesesDe(con), ['2026-05']);
  assert.equal(totalDe(con)[0], 1);
});

await prueba('por reclutador: una traída cuya original no está en ningún tablero cuenta como una respuesta, donde está (igual que antes)', () => {
  const filas = [filaPura('c', 'PB', 'copia-9', 'Filtro nuevo')];
  const sin = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY);
  const con = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY, new Map([['copia-9', 'orig-9']]));
  assert.deepEqual(totalDe(con), totalDe(sin));
  assert.deepEqual(mesesDe(con), ['2026-11']);
});

await prueba('por reclutador: la copia de una traída en un proyecto POSTERIOR no cuenta como «proyecto anterior» de una respuesta recibida antes de que empezara', () => {
  // Original en PA (mayo) traída a PB (noviembre), y otra respuesta real en PC (agosto). Para la de agosto solo PA es anterior: repetida con 1 proyecto antes (no con 2).
  const filas = [filaPura('o', 'PA', 'orig-1', 'Filtro original'), filaPura('c', 'PB', 'copia-1', 'Filtro nuevo'), filaPura('r', 'PC', 'real-1', 'Otro filtro')];
  const con = calcularReclutadores(datosDe(filas), nombresDe(filas), HOY, new Map([['copia-1', 'orig-1']]));
  const t = totalDe(con);
  assert.deepEqual([t[0], t[1], t[2], t[3]], [2, 1, 1, 0], 'dos respuestas: la nueva de mayo y la de agosto repetida con 1 proyecto antes (posición 2), ninguna con 2');
  assert.deepEqual(mesesDe(con), ['2026-05', '2026-08']);
});

await prueba('por reclutador: una traída ya empezada SÍ cuenta como proyecto anterior de una respuesta posterior (la persona ya estaba ahí)', () => {
  // Original en PD (marzo) traída a PA (mayo); otra respuesta real en PC (agosto): antes de agosto la persona estuvo en PD y en PA → repetida con 2 proyectos antes.
  const filas = [filaPura('o', 'PD', 'orig-1', 'Filtro original'), filaPura('c', 'PA', 'copia-1', 'Filtro nuevo'), filaPura('r', 'PC', 'real-1', 'Otro filtro')];
  const t = totalDe(calcularReclutadores(datosDe(filas), nombresDe(filas), HOY, new Map([['copia-1', 'orig-1']])));
  assert.deepEqual([t[0], t[1], t[2], t[3]], [2, 1, 0, 1], 'la de agosto es repetida con 2 proyectos antes (posición 3)');
});

// ── de punta a punta, contra PGlite ─────────────────────────────────────────
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
await pg.exec(`
  create table formularios (
    id uuid primary key default gen_random_uuid(), proyecto_id uuid, codigo text unique not null, titulo text not null, plantilla text,
    definicion jsonb not null, cambios jsonb, vinculo jsonb, generador jsonb, estado text not null default 'borrador', created_by text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table formulario_respuestas (
    id uuid primary key default gen_random_uuid(), formulario_id uuid not null references formularios(id) on delete cascade,
    created_at timestamptz not null default now(), es_prueba boolean not null, respuestas jsonb not null, resultado jsonb not null,
    califica boolean not null default false, nombre text, telefono text, device_token text, duracion_seg int
  );
  create table muestras (
    id uuid primary key default gen_random_uuid(), proyecto_id uuid not null unique, definicion jsonb not null default '{"actividades": []}'::jsonb,
    version int not null default 1, tablero_id text, calendario_id text, created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
`);

const ctx = { user: { id: '00000000-0000-0000-0000-000000000001', email: 'analista@ejemplo.test' } } as any;
const DEF = PLANTILLAS.prueba_tipos.definicion;
const proyecto = async (codigo: string, inicio: string): Promise<string> => (await pg.query<{ id: string }>(
  `insert into projects (project_code, full_name, start_date, client) values ($1, $2, $3::date, 'Cliente Uno') returning id`, [codigo, `Proyecto ${codigo}`, inicio])).rows[0].id;
const tablero = async (nombre: string, codigo: string): Promise<string> => (await pg.query<{ id: string }>(
  `insert into boards (board_name, project_code, board_type) values ($1, $2, 'recruitment') returning id`, [nombre, codigo])).rows[0].id;
let secuencia = 0;
const filtro = async (titulo: string, estado: string, proyectoId: string): Promise<string> => (await pg.query<{ id: string }>(
  `insert into formularios (codigo, titulo, estado, definicion, proyecto_id) values ($1, $2, $3, $4::jsonb, $5) returning id`,
  [`t${++secuencia}`, titulo, estado, JSON.stringify(DEF), proyectoId])).rows[0].id;
const vincular = (formularioId: string, boardId: string) => vincularFormularioTablero.run({ formularioId, boardId }, ctx) as Promise<{ ok: boolean }>;
const filasVivas = async (boardId: string) => Number((await pg.query<{ n: number }>(
  `select count(*)::int as n from recruitment_rows where board_id = $1 and (deleted_at is null or deleted_at = '')`, [boardId])).rows[0].n);

const GENTE = ['Ana Prueba', 'Beto Ejemplo', 'Carla Muestra', 'Dani Demo'];
const RESULTADO = JSON.stringify({ califica: true, descartes: [], gruposExcluidos: [], frentes: [], alertas: [], incompleto: false });
const P_VIEJO = 'SCALE-OLD', P_NUEVO = 'SCALE-NEW';
const proyectoViejo = await proyecto(P_VIEJO, '2026-01-15');
const proyectoNuevo = await proyecto(P_NUEVO, '2026-11-09');
const B1 = await tablero('Tablero viejo', P_VIEJO);
const B2 = await tablero('Tablero nuevo', P_NUEVO);
const F1 = await filtro('Filtro original', 'en_vivo', proyectoViejo);
for (const [i, nombre] of GENTE.entries()) {
  await pg.query(
    `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono) values ($1, false, $2::jsonb, $5::jsonb, true, $3, $4)`,
    [F1, JSON.stringify({ nombre, celular: `5510000${i}00` }), nombre, `5510000${i}00`, RESULTADO],
  );
}
await vincular(F1, B1);
await pasarFormularioAlReclutamiento.run({ formularioId: F1 }, ctx);
// Ana asistió a una sesión del proyecto viejo (del mismo cliente): su historial real no debe perderse al juntar la traída con la original.
await pg.query(`update recruitment_rows set status = 'Asistió' where board_id = $1 and participant_name = 'Ana Prueba'`, [B1]);

const F2 = await filtro('Filtro nuevo', 'prueba', proyectoNuevo);
const traidas = await traerRespuestas(F1, F2);
await vincular(F2, B2);
const limite = Date.now() + 120_000;
while (Date.now() < limite && (await filasVivas(B2)) < GENTE.length) await new Promise((r) => setTimeout(r, 50));
await cargarTraidasAlTablero(F2);

const filaDe = async (boardId: string, nombre: string) => (await pg.query<{ id: string; source_form: string }>(
  `select id, source_form from recruitment_rows where board_id = $1 and participant_name = $2`, [boardId, nombre])).rows[0];

await prueba('el montaje: cada persona está en el tablero viejo con su respuesta y en el nuevo como traída, con otro id de respuesta', async () => {
  assert.equal(traidas.length, GENTE.length);
  assert.equal(await filasVivas(B1), GENTE.length);
  assert.equal(await filasVivas(B2), GENTE.length);
  for (const nombre of GENTE) {
    const vieja = await filaDe(B1, nombre), nueva = await filaDe(B2, nombre);
    assert.notEqual(vieja.source_form.split('|')[1], nueva.source_form.split('|')[1], `${nombre}: la traída tiene su propio id`);
  }
});

olvidarTraidas(); // por si algo alcanzó a guardar un mapa antes de que existieran las traídas
const mapa = await mapaDeTraidas(pool);
await prueba('mapaDeTraidas: cada copia apunta al id de su respuesta original; y una base sin tabla de filtros da el mapa vacío (otros errores sí se propagan)', async () => {
  assert.equal(mapa.size, GENTE.length);
  for (const nombre of GENTE) {
    const vieja = await filaDe(B1, nombre), nueva = await filaDe(B2, nombre);
    assert.equal(mapa.get(nueva.source_form.split('|')[1]), vieja.source_form.split('|')[1]);
  }
  const sinTabla = async () => { throw Object.assign(new Error('relation "formulario_respuestas" does not exist'), { code: '42P01' }); };
  assert.equal((await mapaDeTraidas({ query: sinTabla })).size, 0);
  await assert.rejects(mapaDeTraidas({ query: async () => { throw new Error('se cayó la base'); } }), /se cayó la base/);
});

await prueba('mapaDeTraidasReciente: reusa el mapa (no vuelve a preguntar a la base en el siguiente minuto) y olvidarTraidas lo suelta', async () => {
  olvidarTraidas();
  const primero = await mapaDeTraidasReciente();
  assert.equal(primero.size, GENTE.length);
  // Una traída nueva a media vigencia no se ve todavía…
  const { id: fila, resultado: resultadoAntes } = (await pg.query<{ id: string; resultado: unknown }>(`select id, resultado from formulario_respuestas where resultado ? 'traida' limit 1`)).rows[0];
  await pg.query(`update formulario_respuestas set resultado = resultado - 'traida' where id = $1`, [fila]);
  assert.equal((await mapaDeTraidasReciente()).size, GENTE.length, 'sigue usando el guardado');
  olvidarTraidas();
  assert.equal((await mapaDeTraidasReciente()).size, GENTE.length - 1, 'al olvidarlo, vuelve a leer la base');
  // …y se deja la base como estaba para lo que sigue.
  await pg.query(`update formulario_respuestas set resultado = $2::jsonb where id = $1`, [fila, JSON.stringify(resultadoAntes)]);
  olvidarTraidas();
});

await prueba('tablero: quien se trajo tiene UN filtro llenado (antes dos), sin la señal «registrado en otro estudio»; y a Ana se le conserva lo que sí fue historial real', async () => {
  await getGlobalIdentityData({ fresco: true });
  const r = (await badges.run({ projectCode: P_NUEVO, boardName: 'Tablero nuevo' }, ctx)) as any;
  for (const nombre of GENTE) {
    const b = r.badges[(await filaDe(B2, nombre)).id];
    assert.equal(b.filtrosLlenados, 1, `${nombre}: filtros llenados`);
    if (nombre === 'Ana Prueba') {
      assert.equal(b.participatedSameClient, true, 'Ana asistió en un proyecto del mismo cliente: la alerta sigue');
      assert.ok(b.signals.includes('same_client'));
    } else {
      assert.ok(!b.signals.includes('registered_only'), `${nombre}: la copia de su misma respuesta no es otro estudio (${b.signals.join(',')})`);
      assert.equal(b.participatedSameClient, false);
    }
  }
});

await prueba('historial: la ventana muestra UN filtro llenado, copiado en un tablero más, con el proyecto y el filtro de la original', async () => {
  await getGlobalIdentityData({ fresco: true });
  const fila = (await filaDe(B2, 'Beto Ejemplo')).id;
  const h = (await historial.run({ seedRowId: fila, projectCode: P_NUEVO, boardName: 'Tablero nuevo', rowId: fila, currentClient: 'Cliente Uno' }, ctx)) as any;
  const x = h.results[0];
  assert.equal(x.filtrosLlenados, 1);
  assert.equal(x.llenados.length, 1);
  assert.deepEqual([x.llenados[0].copiasEn, x.llenados[0].proyecto, x.llenados[0].filtro], [1, P_VIEJO, 'Filtro original']);
});

await prueba('por reclutador, con la base: las traídas no cuentan como respuestas (antes ocho respuestas, cuatro de ellas «repetidas» en noviembre); Ana sigue como «entró a un grupo» una vez', async () => {
  const datos = await getGlobalIdentityData({ fresco: true });
  const ids = (await pg.query<{ id: string }>(`select id from recruitment_rows`)).rows.map((r) => r.id);
  const nombres = new Map(ids.map((id) => [id, 'Recluta Uno']));
  const sin = calcularReclutadores(datos, nombres, HOY);
  const con = calcularReclutadores(datos, nombres, HOY, mapa);
  assert.deepEqual([totalDe(sin)[0], totalDe(sin)[1], totalDe(sin)[2]], [8, 4, 4], 'así salía antes: 4 nuevas y 4 repetidas');
  assert.deepEqual(mesesDe(sin), ['2026-01', '2026-11']);
  assert.deepEqual([totalDe(con)[0], totalDe(con)[1], totalDe(con)[2]], [4, 4, 0]);
  assert.deepEqual(mesesDe(con), ['2026-01'], 'noviembre ya no tiene respuestas');
  assert.equal(totalDe(con)[8], 1, 'entró a un grupo: Ana, una vez');
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
