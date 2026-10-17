// Pruebas del módulo «Indicadores» (Reclutamiento): las sumas por periodo y las metas (src/lib/indicadores), el conteo proyecto por proyecto
// (src/serverUtils/indicadores/reclutamiento.ts) sobre un caso inventado donde se conoce cada número, y los endpoints de punta a punta
// contra una base en memoria (PGlite) con el esquema real: acceso solo para Sergio, guardar el cálculo y las metas, y qué pasa si
// todavía no existen las tablas. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-indicadores-reclutamiento.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { buildIdentityClusters, type IdentityRow } from '../../src/lib/duplicateIdentity';
import {
  claveMeta, enPeriodo, estadoMeta, leerMeta, porTrimestre, restarMeses, resumir, valorDe, type DatosReclutamiento, type ProyectoReclutamiento,
} from '../../src/lib/indicadores/reclutamiento';
import { calcularReclutamiento } from '../../src/serverUtils/indicadores/reclutamiento';
import getIndicadoresReclutamiento from '../../src/api/getIndicadoresReclutamiento';
import calcularIndicadoresReclutamiento from '../../src/api/calcularIndicadoresReclutamiento';
import saveIndicadorMeta from '../../src/api/saveIndicadorMeta';

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

const proyecto = (p: Partial<ProyectoReclutamiento> & { codigo: string; fecha: string }): ProyectoReclutamiento => ({
  inferida: false, participaron: 0, noElegibles: 0, porMismoCliente: 0, marcados: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0, ...p,
});

// ── periodos ─────────────────────────────────────────────────────────────────
await prueba('restarMeses: respeta el fin de mes y cruza de año', () => {
  assert.equal(restarMeses('2026-10-17', 12), '2025-10-17');
  assert.equal(restarMeses('2026-10-17', 6), '2026-04-17');
  assert.equal(restarMeses('2026-03-31', 1), '2026-02-28');
  assert.equal(restarMeses('2026-01-15', 2), '2025-11-15');
  assert.equal(restarMeses('2024-03-31', 1), '2024-02-29');
});

const lista = [
  proyecto({ codigo: 'VIEJO', fecha: '2024-02-01', participaron: 10, noElegibles: 5, marcados: 20 }),
  proyecto({ codigo: 'A', fecha: '2025-10-17', participaron: 20, noElegibles: 4, marcados: 40, previas: { 2: 6, 3: 3, 4: 1, 5: 0 }, duplicados: 2 }),
  proyecto({ codigo: 'B', fecha: '2026-04-16', participaron: 30, noElegibles: 3, marcados: 10, previas: { 2: 9, 3: 4, 4: 2, 5: 1 }, duplicados: 6 }),
  proyecto({ codigo: 'C', fecha: '2026-09-30', participaron: 50, noElegibles: 2, marcados: 50, previas: { 2: 5, 3: 1, 4: 0, 5: 0 }, duplicados: 7 }),
  proyecto({ codigo: 'FUTURO', fecha: '2026-12-01', participaron: 99, noElegibles: 99, marcados: 99 }),
];
const HOY = '2026-10-17';
await prueba('enPeriodo: incluye el día de corte, deja fuera lo que aún no empieza y «todo» trae todo lo ya empezado', () => {
  const codigos = (p: Parameters<typeof enPeriodo>[1]) => enPeriodo(lista, p, HOY).map((x) => x.codigo);
  assert.deepEqual(codigos('12m'), ['A', 'B', 'C']);
  assert.deepEqual(codigos('6m'), ['C']);
  assert.deepEqual(codigos('anio'), ['B', 'C']);
  assert.deepEqual(codigos('todo'), ['VIEJO', 'A', 'B', 'C']);
});

// ── resumen y metas ──────────────────────────────────────────────────────────
await prueba('resumir: suma los proyectos y saca cada porcentaje de su propio total', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY), 3);
  assert.equal(r.proyectos, 3);
  assert.equal(r.participaron, 100);
  assert.deepEqual([r.noElegibles, r.pctNoElegibles], [9, 9]);
  assert.deepEqual([r.marcados, r.detectados], [100, 91]);
  assert.equal(r.pctDetectados, 91);
  assert.deepEqual([r.repetidores, r.pctRepetidores], [8, 8]);
  assert.deepEqual([r.duplicados, r.pctDuplicados], [15, 15]);
  assert.equal(resumir(enPeriodo(lista, '12m', HOY), 2).repetidores, 20);
  assert.equal(resumir(enPeriodo(lista, '12m', HOY), 5).repetidores, 1);
});
await prueba('resumir: sin proyectos no hay porcentaje (no se inventa un 0 %)', () => {
  const r = resumir([], 3);
  assert.deepEqual([r.participaron, r.pctNoElegibles, r.pctDetectados, r.pctRepetidores, r.pctDuplicados], [0, null, null, null, null]);
});
await prueba('valorDe: dice de qué total sale cada indicador', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY), 3);
  assert.deepEqual(valorDe(r, 'noElegibles'), { pct: 9, parte: 9, total: 100, de: 'personas que entraron' });
  assert.deepEqual(valorDe(r, 'detectados'), { pct: 91, parte: 91, total: 100, de: 'personas marcadas «no elegible»' });
  assert.equal(valorDe(r, 'repetidores').parte, 8);
  assert.equal(valorDe(r, 'duplicados').parte, 15);
});
await prueba('porTrimestre: agrupa por trimestre de inicio, en orden, con su porcentaje', () => {
  const t = porTrimestre(lista.filter((p) => p.codigo !== 'FUTURO'));
  assert.deepEqual(t.map((x) => x.trimestre), ['2024-T1', '2025-T4', '2026-T2', '2026-T3']);
  assert.deepEqual(t.find((x) => x.trimestre === '2026-T2'), { trimestre: '2026-T2', participaron: 30, noElegibles: 3, pct: 10 });
  assert.equal(porTrimestre([]).length, 0);
});
await prueba('estadoMeta: «menos» y «más» es mejor, comparando con un decimal y sin meta no se juzga', () => {
  assert.equal(estadoMeta(4.9, 5, 'menos'), 'enMeta');
  assert.equal(estadoMeta(5.04, 5, 'menos'), 'enMeta'); // se muestra 5.0 %
  assert.equal(estadoMeta(5.06, 5, 'menos'), 'fuera');
  assert.equal(estadoMeta(95, 90, 'mas'), 'enMeta');
  assert.equal(estadoMeta(89.9, 90, 'mas'), 'fuera');
  assert.equal(estadoMeta(10, undefined, 'menos'), 'sinMeta');
  assert.equal(estadoMeta(null, 5, 'menos'), 'sinMeta');
  assert.equal(estadoMeta(0, 0, 'menos'), 'enMeta');
});
await prueba('claveMeta: la de repetidores depende de cuántas participaciones previas se cuentan', () => {
  assert.equal(claveMeta('repetidores', 3), 'repetidores_3');
  assert.equal(claveMeta('noElegibles', 3), 'noElegibles');
});

await prueba('leerMeta: acepta punto o coma, vacío quita la meta y lo demás no vale', () => {
  assert.equal(leerMeta('5'), 5);
  assert.equal(leerMeta(' 5,5 '), 5.5);
  assert.equal(leerMeta('0'), 0);
  assert.equal(leerMeta('100'), 100);
  assert.equal(leerMeta(''), null);
  assert.equal(leerMeta('   '), null);
  for (const mala of ['abc', '101', '-1', '5%', '1e3', 'NaN', 'Infinity']) assert.equal(leerMeta(mala), undefined, mala);
});

// ── el conteo, con un caso inventado ─────────────────────────────────────────
// Personas (cada una con el mismo correo, nombre y teléfono en todas sus filas, para que sean una sola identidad):
//  Ana: entró a ALFA, BETA (mismo cliente que ALFA) y GAMA (3 meses después de BETA)     → no elegible en BETA y en GAMA
//  Beto: ALFA y, un año después, DELTA                                                    → su participación en ALFA ya es vieja: elegible
//  Carla: solo registrada en ALFA (no participó) y entró a BETA                           → elegible
//  Diego: dos filas idénticas en el mismo tablero de BETA                                 → duplicado
//  Elena: entró a ALFA, sin más                                                           → entrante normal
//  Gina: entró a ALFA; en GAMA quedó «Rechazado» pero en un grupo                         → marcada no elegible en GAMA y NO entró (detectada a tiempo)
//  Hugo: entró a SINFECHA, un proyecto sin ninguna fecha                                  → no se puede contar por proyecto
const PROYECTOS = [
  { codigo: 'ALFA', cliente: 'Cliente Uno', inicio: '2025-01-10' },
  { codigo: 'BETA', cliente: 'Cliente Uno', inicio: '2025-05-10' },
  { codigo: 'GAMA', cliente: 'Cliente Dos', inicio: '2025-06-20' },
  { codigo: 'DELTA', cliente: 'Cliente Tres', inicio: '2026-01-15' },
  { codigo: 'SINFECHA', cliente: 'Cliente Cuatro', inicio: null },
];
const PERSONAS: Record<string, { nombre: string; email: string; tel: string }> = {
  ana: { nombre: 'Ana Prueba Uno', email: 'ana@ejemplo.test', tel: '5500000001' },
  beto: { nombre: 'Beto Prueba Dos', email: 'beto@ejemplo.test', tel: '5500000002' },
  carla: { nombre: 'Carla Prueba Tres', email: 'carla@ejemplo.test', tel: '5500000003' },
  diego: { nombre: 'Diego Prueba Cuatro', email: 'diego@ejemplo.test', tel: '5500000004' },
  elena: { nombre: 'Elena Prueba Cinco', email: 'elena@ejemplo.test', tel: '5500000005' },
  gina: { nombre: 'Gina Prueba Siete', email: 'gina@ejemplo.test', tel: '5500000007' },
  hugo: { nombre: 'Hugo Prueba Ocho', email: 'hugo@ejemplo.test', tel: '5500000008' },
};
const FILAS: Array<{ persona: string; proyecto: string; tablero: string; status: string; grupo?: string }> = [
  { persona: 'ana', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió', grupo: 'G1' },
  { persona: 'beto', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'carla', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Contactado' },
  { persona: 'elena', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'gina', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'ana', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió', grupo: 'G1' },
  { persona: 'carla', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'diego', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'diego', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'ana', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Asistió' },
  { persona: 'gina', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Rechazado', grupo: 'G2' },
  { persona: 'beto', proyecto: 'DELTA', tablero: 'Tablero D', status: 'Asistió' },
  { persona: 'hugo', proyecto: 'SINFECHA', tablero: 'Tablero E', status: 'Asistió' },
];

const filasIdentidad: IdentityRow[] = FILAS.map((f, i) => ({
  id: `fila-${i + 1}`, projectCode: f.proyecto, boardName: f.tablero, participantName: PERSONAS[f.persona].nombre,
  email: PERSONAS[f.persona].email, phone: PERSONAS[f.persona].tel, status: f.status, group: f.grupo ?? '',
}));
const globalClusters = buildIdentityClusters(filasIdentidad, { mode: 'strict' });
const rowToGlobalCluster = new Map<string, string>();
for (const [cid, c] of globalClusters) for (const id of c.rowIds) rowToGlobalCluster.set(id, cid);
const projectMap = new Map(PROYECTOS.map((p) => [p.codigo, { client: p.cliente, ...(p.inicio ? { startDate: p.inicio } : {}) }]));

const ESPERADO: DatosReclutamiento = {
  proyectos: [
    { codigo: 'ALFA', cliente: 'Cliente Uno', fecha: '2025-01-10', inferida: false, participaron: 4, noElegibles: 0, porMismoCliente: 0, marcados: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0 },
    { codigo: 'BETA', cliente: 'Cliente Uno', fecha: '2025-05-10', inferida: false, participaron: 3, noElegibles: 1, porMismoCliente: 1, marcados: 1, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 1 },
    { codigo: 'GAMA', cliente: 'Cliente Dos', fecha: '2025-06-20', inferida: false, participaron: 1, noElegibles: 1, porMismoCliente: 0, marcados: 2, previas: { 2: 1, 3: 0, 4: 0, 5: 0 }, duplicados: 0 },
    { codigo: 'DELTA', cliente: 'Cliente Tres', fecha: '2026-01-15', inferida: false, participaron: 1, noElegibles: 0, porMismoCliente: 0, marcados: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0 },
  ],
  vida: { personas: 7, enAlMenos: { 2: 2, 3: 1, 5: 0, 10: 0 } },
  sinFecha: 1,
};

await prueba('el caso inventado tiene las 7 identidades esperadas (Diego, con dos filas, es una sola)', () => {
  assert.equal(globalClusters.size, 7);
});
await prueba('calcularReclutamiento: cada proyecto sale con los números del caso', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  assert.deepEqual(r.proyectos, ESPERADO.proyectos);
});
await prueba('calcularReclutamiento: personas repetidas de por vida y proyecto sin fecha', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  assert.deepEqual(r.vida, ESPERADO.vida);
  assert.equal(r.sinFecha, ESPERADO.sinFecha);
});
await prueba('calcularReclutamiento: la marcada que no entró cuenta como detectada a tiempo', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  const gama = r.proyectos.find((p) => p.codigo === 'GAMA')!;
  assert.equal(gama.marcados - gama.noElegibles, 1);
});
await prueba('calcularReclutamiento: con las mismas filas dos veces da lo mismo y sin filas no truena', () => {
  const vacio = calcularReclutamiento({ activeRows: [], projectMap, globalClusters: new Map(), rowToGlobalCluster: new Map() });
  assert.deepEqual(vacio, { proyectos: [], vida: { personas: 0, enAlMenos: { 2: 0, 3: 0, 5: 0, 10: 0 } }, sinFecha: 0 });
});

// ── endpoints, de punta a punta contra PGlite ────────────────────────────────
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
(pool as any).query = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};

await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
// Las tablas se crean con el SQL del propio script, no con una copia que se pueda desviar.
const script = fs.readFileSync(new URL('./add-indicadores-tables.ts', import.meta.url), 'utf8');
const ddl = script.match(/pool\.query\(`([\s\S]*?)`\)/)?.[1];
assert.ok(ddl, 'no se encontró el SQL en add-indicadores-tables.ts');

for (const p of PROYECTOS) {
  await pg.query(`insert into projects (project_code, client, start_date) values ($1, $2, $3)`, [p.codigo, p.cliente, p.inicio]);
}
for (const [i, f] of FILAS.entries()) {
  const persona = PERSONAS[f.persona];
  await pg.query(
    `insert into recruitment_rows (row_name, project_code, board_name, participant_name, email, phone, status, "group", row_order) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [persona.nombre, f.proyecto, f.tablero, persona.nombre, persona.email, persona.tel, f.status, f.grupo ?? null, i],
  );
}

// Desde la base, un proyecto sin fecha de inicio toma la de su última actividad real (projectStartFallback) y queda marcado como inferido:
// por eso SINFECHA ya sí se cuenta, con la fecha de hoy (las filas se acaban de insertar), y deja de estar en «sinFecha».
const esperadoDeLaBase = (): DatosReclutamiento => ({
  ...ESPERADO,
  proyectos: [
    ...ESPERADO.proyectos,
    { codigo: 'SINFECHA', cliente: 'Cliente Cuatro', fecha: new Date().toISOString().slice(0, 10), inferida: true, participaron: 1, noElegibles: 0, porMismoCliente: 0, marcados: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0 },
  ],
  sinFecha: 0,
});

const sergio = { user: { id: 'u1', email: 'sergio@sapience.com.mx' } };
const otra = { user: { id: 'u2', email: 'alguien@ejemplo.test' } };
const sinSesion = { user: null };
const rechazadoPor = (codigo: string) => (e: unknown) => e instanceof ZiteError && e.code === codigo;

await prueba('sin las tablas: la pantalla abre vacía, y calcular o guardar una meta dicen qué falta', async () => {
  assert.deepEqual(await getIndicadoresReclutamiento.run({}, sergio), { metas: {} });
  await assert.rejects(() => calcularIndicadoresReclutamiento.run({}, sergio), (e: unknown) => e instanceof ZiteError && /add-indicadores-tables/.test(e.message));
  await assert.rejects(() => saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, sergio), (e: unknown) => e instanceof ZiteError && /add-indicadores-tables/.test(e.message));
});

await pg.exec(ddl!);

await prueba('solo Sergio: otra persona y quien no ha entrado reciben «no autorizado» en los tres endpoints', async () => {
  for (const contexto of [otra, sinSesion]) {
    const codigo = contexto.user ? 'FORBIDDEN' : 'UNAUTHORIZED';
    await assert.rejects(() => getIndicadoresReclutamiento.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => calcularIndicadoresReclutamiento.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, contexto), rechazadoPor(codigo));
  }
});
await prueba('antes de calcular no hay datos ni fecha, y las metas empiezan vacías', async () => {
  assert.deepEqual(await getIndicadoresReclutamiento.run({}, sergio), { metas: {} });
});
await prueba('calcular: lee la base, guarda y devuelve lo del caso inventado (el proyecto sin fecha, con su fecha inferida)', async () => {
  const r: any = await calcularIndicadoresReclutamiento.run({}, sergio);
  assert.deepEqual(r.datos, esperadoDeLaBase());
  assert.ok(Date.now() - new Date(r.calculadoEn).getTime() < 60_000, 'fecha de cálculo reciente');
  assert.deepEqual(r.metas, {});
});
await prueba('después de calcular, abrir la pantalla devuelve lo guardado sin volver a calcular', async () => {
  const r: any = await getIndicadoresReclutamiento.run({}, sergio);
  assert.deepEqual(r.datos, esperadoDeLaBase());
  const guardado = (await pg.query<{ calculado_por: string }>(`select calculado_por from indicadores_calculos where area = 'reclutamiento'`)).rows;
  assert.deepEqual(guardado, [{ calculado_por: 'sergio@sapience.com.mx' }]);
});
await prueba('calcular otra vez reemplaza el cálculo (una sola fila por área)', async () => {
  await calcularIndicadoresReclutamiento.run({}, sergio);
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from indicadores_calculos`)).rows[0].n), 1);
});
await prueba('dos cálculos a la vez se juntan en uno solo', async () => {
  const [a, b]: any[] = await Promise.all([calcularIndicadoresReclutamiento.run({}, sergio), calcularIndicadoresReclutamiento.run({}, sergio)]);
  assert.equal(a.calculadoEn, b.calculadoEn);
});
await prueba('metas: guardar, cambiar y borrar; se ven al abrir la pantalla', async () => {
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'repetidores_3', valor: 2.5 }, sergio);
  assert.deepEqual(((await getIndicadoresReclutamiento.run({}, sergio)) as any).metas, { noElegibles: 5, repetidores_3: 2.5 });
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 4 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'repetidores_3', valor: null }, sergio);
  assert.deepEqual(((await getIndicadoresReclutamiento.run({}, sergio)) as any).metas, { noElegibles: 4 });
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 0 }, sergio);
  assert.deepEqual(((await getIndicadoresReclutamiento.run({}, sergio)) as any).metas, { noElegibles: 0 });
});
await prueba('metas: un indicador que no existe, un área desconocida o un porcentaje fuera de 0–100 se rechazan', async () => {
  for (const mala of [
    { area: 'reclutamiento', indicador: 'inventado', valor: 5 },
    { area: 'reclutamiento', indicador: 'repetidores_9', valor: 5 },
    { area: 'comercial', indicador: 'noElegibles', valor: 5 },
    { area: 'reclutamiento', indicador: 'noElegibles', valor: 101 },
    { area: 'reclutamiento', indicador: 'noElegibles', valor: -1 },
  ]) await assert.rejects(() => saveIndicadorMeta.run(mala, sergio), rechazadoPor('BAD_REQUEST'));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
