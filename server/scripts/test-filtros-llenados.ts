// Pruebas de «cuántos filtros ha llenado» cada persona (src/lib/filtrosLlenados.ts), del tablero (getBoardDuplicateBadges) y de la ventana de historial (searchParticipantHistory):
// cada respuesta cuenta una vez aunque esté copiada en varios tableros, las filas sin id de respuesta no cuentan, el contacto compartido no lleva número y la confianza sale de lo que
// varían los datos. Lo de la base, contra PGlite con el esquema real. Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-filtros-llenados.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { contarFiltrosLlenados, esContactoCompartido, filtrosLlenadosDe, nombreDelFiltro, MIN_NOMBRES_COMPARTIDO, MIN_RESPUESTAS_COMPARTIDO } from '../../src/lib/filtrosLlenados';
import type { IdentityRow } from '../../src/lib/duplicateIdentity';

process.env.STRICT_OUTPUT = 'true';
const badges = (await import('../../src/api/getBoardDuplicateBadges')).default;
const historial = (await import('../../src/api/searchParticipantHistory')).default;
const { getGlobalIdentityData } = await import('../../src/lib/globalIdentityCache');
const { MIN_RESPUESTAS_COMPARTIDO: DEL_RECLUTADOR } = await import('../../src/serverUtils/indicadores/reclutadores');

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

// ── la cuenta sola (sin base) ────────────────────────────────────────────────
let k = 0;
const fila = (extra: Partial<IdentityRow> & { respuesta?: string | null; filtro?: string } = {}): IdentityRow => {
  k++;
  const { respuesta, filtro, ...resto } = extra;
  return {
    id: `f${k}`, email: 'ana@ejemplo.test', phone: '5500001111', participantName: 'Ana Prueba', projectCode: 'P1', boardName: 'T1',
    sourceForm: respuesta === null ? undefined : `${filtro ?? 'Filtro de prueba'}|${respuesta ?? `r${k}`}`, ...resto,
  };
};

await prueba('cada respuesta cuenta una vez aunque esté copiada en varios tableros (el mismo filtro vinculado a varios)', () => {
  const r = contarFiltrosLlenados([fila({ respuesta: 'r-a', boardName: 'T1' }), fila({ respuesta: 'r-a', boardName: 'T2' }), fila({ respuesta: 'r-a', projectCode: 'P2', boardName: 'T3' })]);
  assert.equal(r.filtrosLlenados, 1);
  assert.equal(r.filasSinFiltro, 0);
});
await prueba('dos respuestas distintas, aunque sean del mismo filtro, son dos veces que lo llenó', () => {
  assert.equal(contarFiltrosLlenados([fila({ respuesta: 'r-a' }), fila({ respuesta: 'r-b' })]).filtrosLlenados, 2);
});
await prueba('las filas sin id de respuesta (a mano o de Excel) no cuentan como filtros llenados, pero se avisa cuántas son', () => {
  const r = contarFiltrosLlenados([fila({ respuesta: 'r-a' }), fila({ respuesta: null }), fila({ respuesta: null })]);
  assert.deepEqual([r.filtrosLlenados, r.filasSinFiltro], [1, 2]);
});
await prueba('quien solo tiene filas sin id tiene 0 filtros llenados (no «1»)', () => {
  assert.deepEqual(contarFiltrosLlenados([fila({ respuesta: null })]).filtrosLlenados, 0);
});
await prueba('un contacto compartido (5 o más respuestas y 3 o más nombres) no lleva número', () => {
  const nombres = ['Uno Uno', 'Dos Dos', 'Tres Tres', 'Uno Uno', 'Dos Dos'];
  const r = contarFiltrosLlenados(nombres.map((nom, i) => fila({ respuesta: `c${i}`, participantName: nom })));
  assert.deepEqual([r.compartido, r.filtrosLlenados], [true, null]);
});
await prueba('con pocas respuestas o pocos nombres NO es contacto compartido: se cuenta normal', () => {
  const cuatro = contarFiltrosLlenados(['A A', 'B B', 'C C', 'A A'].map((nom, i) => fila({ respuesta: `d${i}`, participantName: nom })));
  assert.deepEqual([cuatro.compartido, cuatro.filtrosLlenados], [false, 4]);
  const mismoNombre = contarFiltrosLlenados([0, 1, 2, 3, 4, 5].map((i) => fila({ respuesta: `e${i}` })));
  assert.deepEqual([mismoNombre.compartido, mismoNombre.filtrosLlenados], [false, 6]);
});
await prueba('para ser contacto compartido las filas sin id cuentan como una respuesta cada una, igual que en «Por reclutador»', () => {
  const nombres = ['Uno Uno', 'Dos Dos', 'Tres Tres', 'Uno Uno', 'Dos Dos'];
  const r = contarFiltrosLlenados(nombres.map((nom) => fila({ respuesta: null, participantName: nom })));
  assert.equal(r.compartido, true);
});
await prueba('los umbrales son los mismos en el tablero y en «Por reclutador» (una sola definición)', () => {
  assert.equal(DEL_RECLUTADOR, MIN_RESPUESTAS_COMPARTIDO);
  assert.equal(esContactoCompartido(MIN_RESPUESTAS_COMPARTIDO, MIN_NOMBRES_COMPARTIDO), true);
  assert.equal(esContactoCompartido(MIN_RESPUESTAS_COMPARTIDO - 1, MIN_NOMBRES_COMPARTIDO), false);
  assert.equal(esContactoCompartido(MIN_RESPUESTAS_COMPARTIDO, MIN_NOMBRES_COMPARTIDO - 1), false);
});
await prueba('confianza «segura» cuando todos los datos coinciden (aunque el nombre cambie de mayúsculas o acentos)', () => {
  const r = contarFiltrosLlenados([fila({ respuesta: 'a', participantName: 'José Pérez' }), fila({ respuesta: 'b', participantName: 'JOSE  PEREZ' })]);
  assert.equal(r.confianza, 'segura');
});
await prueba('confianza «probable» cuando un dato tiene dos valores (otro teléfono, otro correo o el nombre escrito distinto)', () => {
  assert.equal(contarFiltrosLlenados([fila({ respuesta: 'a' }), fila({ respuesta: 'b', phone: '5599998888' })]).confianza, 'probable');
  assert.equal(contarFiltrosLlenados([fila({ respuesta: 'a' }), fila({ respuesta: 'b', email: 'otro@ejemplo.test' })]).confianza, 'probable');
  assert.equal(contarFiltrosLlenados([fila({ respuesta: 'a' }), fila({ respuesta: 'b', participantName: 'Ana P.' })]).confianza, 'probable');
});
await prueba('confianza «revisar» cuando algún dato tiene 3 o más valores: pudieron juntarse dos personas', () => {
  const r = contarFiltrosLlenados([fila({ respuesta: 'a' }), fila({ respuesta: 'b', phone: '5599998888' }), fila({ respuesta: 'c', phone: '5577776666' })]);
  assert.equal(r.confianza, 'revisar');
});
await prueba('un nombre placeholder o muy corto no cuenta como variación (no es una señal de identidad)', () => {
  const r = contarFiltrosLlenados([fila({ respuesta: 'a' }), fila({ respuesta: 'b', participantName: 'new item' }), fila({ respuesta: 'c', participantName: 'xy' })]);
  assert.equal(r.confianza, 'segura');
});
await prueba('nombreDelFiltro: quita el prefijo de los filtros del Hub y la respuesta; sin nombre, nada', () => {
  assert.equal(nombreDelFiltro('Formulario Hub · Mi filtro|abc123'), 'Mi filtro');
  assert.equal(nombreDelFiltro('SCREENER Ejemplo|xyz'), 'SCREENER Ejemplo');
  assert.equal(nombreDelFiltro('|solo-id'), undefined);
  assert.equal(nombreDelFiltro(undefined), undefined);
});
await prueba('filtrosLlenadosDe: una entrada por respuesta, la más reciente primero, con los datos de la copia más antigua y cuántos tableros más la copian', () => {
  const fechas: Record<string, string> = { P1: '2025-01-10', P2: '2025-06-10', P3: '2026-03-10' };
  const lista = filtrosLlenadosDe([
    fila({ respuesta: 'r-a', projectCode: 'P2', boardName: 'T9', participantName: 'Ana Copia', filtro: 'Formulario Hub · Filtro viejo' }),
    fila({ respuesta: 'r-a', projectCode: 'P1', boardName: 'T1', participantName: 'Ana Origen', email: 'origen@ejemplo.test', phone: '5500001111', filtro: 'Formulario Hub · Filtro viejo' }),
    fila({ respuesta: 'r-a', projectCode: 'P1', boardName: 'T2', filtro: 'Formulario Hub · Filtro viejo' }),
    fila({ respuesta: 'r-b', projectCode: 'P3', boardName: 'T1', filtro: 'Otro filtro' }),
    fila({ respuesta: null, projectCode: 'P3' }),
  ], (codigo) => fechas[codigo]);
  assert.deepEqual(lista.map((l) => l.respuestaId), ['r-b', 'r-a']);
  const a = lista[1];
  assert.deepEqual([a.proyecto, a.fecha, a.copiasEn, a.nombre, a.correo, a.filtro], ['P1', '2025-01-10', 2, 'Ana Origen', 'origen@ejemplo.test', 'Filtro viejo']);
  assert.deepEqual([lista[0].proyecto, lista[0].fecha, lista[0].copiasEn, lista[0].filtro], ['P3', '2026-03-10', 0, 'Otro filtro']);
});

// ── contra una base en memoria con el esquema real ───────────────────────────
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
const ctx = { user: { id: 'u-prueba', email: 'prueba@ejemplo.test', role: 'Líder' } } as any;
const proyecto = (codigo: string, cliente: string, inicio: string) => pg.query(`insert into projects (project_code, client, start_date) values ($1, $2, $3)`, [codigo, cliente, inicio]);
await proyecto('FIL-A', 'Cliente Alfa', '2025-01-10');
await proyecto('FIL-B', 'Cliente Alfa', '2025-06-10');
await proyecto('FIL-C', 'Cliente Beta', '2026-03-10');
await proyecto('FIL-ACTUAL', 'Cliente Alfa', '2026-10-20');

const insertar = async (proyectoCodigo: string, tablero: string, p: { nombre: string; email?: string; tel?: string }, respuesta: string | null, filtro = 'Filtro de prueba', estatus = 'Pendiente') =>
  (await pg.query<{ id: string }>(
    `insert into recruitment_rows (project_code, board_name, participant_name, email, phone, status, source_form) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [proyectoCodigo, tablero, p.nombre, p.email ?? null, p.tel ?? null, estatus, respuesta ? `${filtro}|${respuesta}` : null],
  )).rows[0].id;

// X: tres filtros distintos; el primero está copiado a otro tablero del mismo proyecto; todos sus datos coinciden.
const X = { nombre: 'Persona Equis', email: 'equis@ejemplo.test', tel: '5500001001' };
await insertar('FIL-A', 'Tablero A1', X, 'resp-x1', 'Formulario Hub · Filtro viejo');
await insertar('FIL-A', 'Tablero A2', X, 'resp-x1', 'Formulario Hub · Filtro viejo');
await insertar('FIL-B', 'Tablero B', X, 'resp-x2');
const filaXActual = await insertar('FIL-ACTUAL', 'Tablero', X, 'resp-x3');
// Y: un filtro y, además, una fila capturada a mano (sin id de respuesta).
const Y = { nombre: 'Persona Ye', email: 'ye@ejemplo.test', tel: '5500001002' };
await insertar('FIL-C', 'Tablero C', Y, null);
const filaYActual = await insertar('FIL-ACTUAL', 'Tablero', Y, 'resp-y1');
// Z: un contacto compartido: 5 respuestas con 3 nombres.
const nombresZ = ['Zeta Uno', 'Zeta Dos', 'Zeta Tres', 'Zeta Uno', 'Zeta Dos'];
const idsZ: string[] = [];
for (let i = 0; i < 5; i++) idsZ.push(await insertar(i < 4 ? ['FIL-A', 'FIL-B', 'FIL-C', 'FIL-A'][i] : 'FIL-ACTUAL', i === 4 ? 'Tablero' : `Tablero Z${i}`, { nombre: nombresZ[i], email: 'compartido@ejemplo.test', tel: '5500001003' }, `resp-z${i}`));
// W: tres teléfonos distintos unidos por el mismo correo y nombre → «revisar».
const W = { nombre: 'Persona Doble', email: 'doble@ejemplo.test' };
await insertar('FIL-A', 'Tablero A1', { ...W, tel: '5500001004' }, 'resp-w1');
await insertar('FIL-B', 'Tablero B', { ...W, tel: '5500001005' }, 'resp-w2');
const filaWActual = await insertar('FIL-ACTUAL', 'Tablero', { ...W, tel: '5500001006' }, 'resp-w3');
// V: una sola vez.
const V = { nombre: 'Persona Uve', email: 'uve@ejemplo.test', tel: '5500001007' };
const filaVActual = await insertar('FIL-ACTUAL', 'Tablero', V, 'resp-v1');
// U: solo una fila a mano.
const filaUActual = await insertar('FIL-ACTUAL', 'Tablero', { nombre: 'Persona U', email: 'u@ejemplo.test', tel: '5500001008' }, null);

await getGlobalIdentityData({ fresco: true });
const r = (await badges.run({ projectCode: 'FIL-ACTUAL', boardName: 'Tablero' }, ctx)) as any;
const de = (id: string) => r.badges[id];

await prueba('tablero: X lleva 3 (la respuesta copiada a otro tablero cuenta una vez) y sus datos coinciden', () => {
  const b = de(filaXActual);
  assert.deepEqual([b.filtrosLlenados, b.filasSinFiltro, b.compartido, b.confianza], [3, 0, false, 'segura']);
});
await prueba('tablero: Y lleva 1 filtro y avisa de su fila sin filtro (la capturada a mano no cuenta)', () => {
  const b = de(filaYActual);
  assert.deepEqual([b.filtrosLlenados, b.filasSinFiltro], [1, 1]);
});
await prueba('tablero: el contacto compartido no lleva número', () => {
  const b = de(idsZ[4]);
  assert.deepEqual([b.compartido, b.filtrosLlenados], [true, null]);
});
await prueba('tablero: W, con tres teléfonos distintos, lleva 3 y la marca «revisar»', () => {
  const b = de(filaWActual);
  assert.deepEqual([b.filtrosLlenados, b.confianza], [3, 'revisar']);
});
await prueba('tablero: quien llenó una sola vez lleva 1; quien solo tiene una fila a mano lleva 0', () => {
  assert.equal(de(filaVActual).filtrosLlenados, 1);
  assert.equal(de(filaUActual).filtrosLlenados, 0);
});
await prueba('tablero: lo de siempre no cambia (sigue trayendo las señales de historial y elegibilidad)', () => {
  const b = de(filaXActual);
  assert.ok(Array.isArray(b.signals));
  assert.equal(typeof b.hasHighRisk, 'boolean');
  assert.equal(typeof b.sameBoardCount, 'number');
});
await prueba('historial: en la ventana de una fila trae el resumen y la lista, la más reciente primero, con los datos que usó cada vez', async () => {
  const h = (await historial.run({ seedRowId: filaXActual, projectCode: 'FIL-ACTUAL', boardName: 'Tablero', rowId: filaXActual }, ctx)) as any;
  const p = h.results[0];
  assert.deepEqual([p.filtrosLlenados, p.filasSinFiltro, p.compartido, p.confianza], [3, 0, false, 'segura']);
  assert.deepEqual(p.llenados.map((l: any) => l.respuestaId), ['resp-x3', 'resp-x2', 'resp-x1']);
  const primero = p.llenados[2];
  assert.deepEqual([primero.proyecto, primero.fecha, primero.copiasEn, primero.filtro, primero.nombre, primero.correo], ['FIL-A', '2025-01-10', 1, 'Filtro viejo', 'Persona Equis', 'equis@ejemplo.test']);
});
await prueba('historial: el contacto compartido no trae número y W trae sus tres teléfonos distintos para confirmarlos', async () => {
  const hz = (await historial.run({ seedRowId: idsZ[4], projectCode: 'FIL-ACTUAL', boardName: 'Tablero', rowId: idsZ[4] }, ctx)) as any;
  assert.deepEqual([hz.results[0].compartido, hz.results[0].filtrosLlenados], [true, null]);
  const hw = (await historial.run({ seedRowId: filaWActual, projectCode: 'FIL-ACTUAL', boardName: 'Tablero', rowId: filaWActual }, ctx)) as any;
  assert.deepEqual(new Set(hw.results[0].llenados.map((l: any) => l.telefono)), new Set(['5500001004', '5500001005', '5500001006']));
  assert.equal(hw.results[0].confianza, 'revisar');
});
await prueba('historial: la búsqueda por texto (modo exploratorio) no trae estos campos: solo la ventana de una persona completa', async () => {
  const h = (await historial.run({ query: 'Persona Equis', projectCode: 'FIL-ACTUAL', boardName: 'Tablero' }, ctx)) as any;
  assert.ok(h.results.length > 0);
  assert.equal(h.results[0].filtrosLlenados, undefined);
  assert.equal(h.results[0].llenados, undefined);
});
await prueba('el mismo número en el tablero y en el historial para cada persona', async () => {
  for (const [fila, clave] of [[filaXActual, 'X'], [filaYActual, 'Y'], [filaVActual, 'V'], [filaWActual, 'W']] as const) {
    const h = (await historial.run({ seedRowId: fila, projectCode: 'FIL-ACTUAL', boardName: 'Tablero', rowId: fila }, ctx)) as any;
    assert.equal(h.results[0].filtrosLlenados, de(fila).filtrosLlenados, clave);
    assert.equal(h.results[0].llenados.length, de(fila).filtrosLlenados, `${clave}: la lista tiene tantos como el número`);
  }
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
