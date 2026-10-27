// Pruebas de la pantalla «Costos por proyecto» (src/api/getMultiProjectCostAnalysis.ts) contra una base en memoria (PGlite) con el esquema real.
// Lo que cuidan: el «cotizado» sale de las partidas de las cotizaciones del deal (una cotización en Borrador cuenta, no hace falta aprobarla; una excluida no),
// «Costos reales» sale de las órdenes de compra vigentes, y con más de 100 cotizaciones (varios lotes) no se pierde ninguna.
// También el selector de deals para vincular un proyecto (orden y búsqueda) y que la lista de deals no se corte pasados los 500.
// Antes de arreglarlo, el cálculo leía la lista de partidas que Zite guardaba en la cotización; en Postgres no existe y todos los proyectos salían con $0 cotizado.
// Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-costos.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

const costos = (await import('../../src/api/getMultiProjectCostAnalysis')).default;
const { buscarDeals, ordenarDeals } = await import('../../src/lib/finance/dealPicker');

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

const ctx = { user: { id: 'usuario-de-prueba', email: 'costos@ejemplo.test' } } as any;
const analizar = async (projectIds?: string[]) => (await costos.run({ projectIds }, ctx)) as any;
const id = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params as any)).rows[0].id;

const deal = (nombre: string, precio: number) => id(`insert into deals (deal_name, phase, client_price, currency) values ($1, 'Ganado', $2, 'MXN 🇲🇽') returning id`, [nombre, precio]);
const proyecto = (codigo: string, dealId: string) => id(`insert into projects (project_code, deal_vinculado_id) values ($1, $2) returning id`, [codigo, dealId]);
const cotizacion = (dealId: string, estado: string, incluida: boolean | null) => id(`insert into cotizaciones (deal_id, status, included, currency) values ($1, $2, $3, 'MXN') returning id`, [dealId, estado, incluida]);
const partida = (cotId: string, rubro: string, costo: number, cantidad: number, componentes: number | null, precio: number) =>
  pg.query(`insert into cotizacion_line_items (cotizacion_id, rubro, sub_rubro, unit_cost, cantidad, componentes, final_price) values ($1, $2, 'Concepto', $3, $4, $5, $6)`, [cotId, rubro, costo, cantidad, componentes, precio]);
const orden = (codigo: string, categoria: string, estado: string, monto: number) =>
  pg.query(`insert into purchase_orders (project_code, category, status, total_amount, currency) values ($1, $2, $3, $4, 'MXN')`, [codigo, categoria, estado, monto]);

// Proyecto A: una cotización en Borrador (incluida) con partidas en los cinco rubros, otra excluida y órdenes de compra de varios estados.
const dealA = await deal('Deal de prueba A', 100000);
const proyectoA = await proyecto('PRB-A', dealA);
const cotA = await cotizacion(dealA, 'Borrador', true);
await partida(cotA, 'Reclutamiento e incentivos', 1000, 6, 8, 72000);
await partida(cotA, 'Moderación', 3500, 6, null, 31500);
await partida(cotA, 'Management', 25000, 1, 1, 37500);
await partida(cotA, 'Back office', 2500, 6, null, 22500);
await partida(cotA, 'Logística y operación', 0, 0, null, 0);
const cotExcluida = await cotizacion(dealA, 'Borrador', false);
await partida(cotExcluida, 'Moderación', 99999, 1, 1, 99999);
await orden('PRB-A', 'Reclutamiento e Incentivos', 'Aprobada', 74200);
await orden('PRB-A', 'Moderaciones', 'Pagada', 16800);
await orden('PRB-A', 'Moderaciones', 'Cancelada', 5000);
await orden('PRB-A', 'Logística', 'Borrador', 100);

// Proyecto B: deal sin ninguna cotización.
const dealB = await deal('Deal de prueba B', 50000);
const proyectoB = await proyecto('PRB-B', dealB);

console.log('— Costos por proyecto —');

await prueba('el «cotizado» sale de las partidas de la cotización del deal, también si está en Borrador (no hace falta aprobarla)', async () => {
  const a = (await analizar([proyectoA])).projects[0];
  const por = Object.fromEntries(a.byRubro.map((r: any) => [r.rubro, r]));
  assert.equal(por['Reclutamiento e incentivos'].cotizado, 1000 * 6 * 8);
  assert.equal(por['Reclutamiento e incentivos'].costoConMarkup, 72000);
  assert.equal(por['Moderación'].cotizado, 3500 * 6, 'sin «componentes» cuenta como 1');
  assert.equal(por['Moderación'].costoConMarkup, 31500);
  assert.equal(por['Management'].cotizado, 25000);
  assert.equal(por['Back office'].cotizado, 15000);
  assert.equal(por['Logística y operación'].cotizado, 0);
  assert.equal(a.totals.cotizado, 48000 + 21000 + 25000 + 15000);
  assert.equal(a.totals.costoConMarkup, 72000 + 31500 + 37500 + 22500);
});

await prueba('una cotización marcada como excluida no suma', async () => {
  const a = (await analizar([proyectoA])).projects[0];
  assert.equal(a.byRubro.find((r: any) => r.rubro === 'Moderación').cotizado, 21000, 'los 99,999 de la cotización excluida no entran');
});

await prueba('el precio del deal se reparte entre los rubros según su peso en la cotización y el total es el precio del deal', async () => {
  const a = (await analizar([proyectoA])).projects[0];
  assert.equal(a.totals.precioCliente, 100000);
  const suma = a.byRubro.reduce((s: number, r: any) => s + r.precioCliente, 0);
  assert.ok(Math.abs(suma - 100000) < 0.01, `los rubros suman ${suma}`);
  const recl = a.byRubro.find((r: any) => r.rubro === 'Reclutamiento e incentivos');
  assert.ok(Math.abs(recl.precioCliente - (72000 / 163500) * 100000) < 0.01);
  assert.ok(Math.abs(recl.markUpInicial - 24000) < 0.01, 'precio con markup menos costo');
});

await prueba('«Costos reales» suma las órdenes de compra vigentes por rubro (sin Borrador ni Cancelada)', async () => {
  const a = (await analizar([proyectoA])).projects[0];
  const por = Object.fromEntries(a.byRubro.map((r: any) => [r.rubro, r.gastado]));
  assert.equal(por['Reclutamiento e incentivos'], 74200);
  assert.equal(por['Moderación'], 16800, 'la cancelada de 5,000 no cuenta');
  assert.equal(por['Logística y operación'], 0, 'la de Borrador no cuenta');
  assert.equal(a.totals.gastado, 91000);
  assert.equal(a.totals.markUpFinal, 100000 - 91000);
});

await prueba('un deal sin cotización deja el cotizado en $0 y conserva el precio del deal en el total', async () => {
  const b = (await analizar([proyectoB])).projects[0];
  assert.equal(b.totals.cotizado, 0);
  assert.equal(b.totals.precioCliente, 50000);
});

await prueba('con más de 100 cotizaciones (varios lotes de búsqueda) todas traen sus partidas', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 120; i++) {
    const d = await deal(`Deal lote ${i}`, 1000);
    ids.push(await proyecto(`LOTE-${i}`, d));
    const c = await cotizacion(d, 'Borrador', true);
    await partida(c, 'Back office', 10, 1, null, 15);
  }
  const todo = await analizar();
  const lote = todo.projects.filter((p: any) => String(p.project.projectCode).startsWith('LOTE-'));
  assert.equal(lote.length, 120);
  assert.ok(lote.every((p: any) => p.totals.cotizado === 10), 'alguno quedó sin su partida');
  assert.equal(todo.grandTotals.cotizado, 109000 + 120 * 10);
});

await prueba('selector de deals: orden alfabético en español, sin importar acentos ni mayúsculas, con los números como números', () => {
  const lista = [{ id: '1', dealName: 'Fase 10' }, { id: '2', dealName: 'BTS 2' }, { id: '3', dealName: 'ñandú' }, { id: '4', dealName: 'BTS' }, { id: '5', dealName: 'Fase 2' }, { id: '6', dealName: 'Óptica' }, { id: '7', dealName: 'Zeta' }, { id: '8' }];
  assert.deepEqual(ordenarDeals(lista).map((d) => d.dealName ?? ''), ['', 'BTS', 'BTS 2', 'Fase 2', 'Fase 10', 'ñandú', 'Óptica', 'Zeta']);
});

await prueba('selector de deals: busca por nombre o cliente con todas las palabras, sin acentos ni mayúsculas, y primero salen los que empiezan con lo escrito', () => {
  const deals = [
    { id: 'a', dealName: 'BTS 2', client: 'Danone' },
    { id: 'b', dealName: 'BTS', client: 'Danone' },
    { id: 'c', dealName: 'Cotización de empaque', client: 'Marca X' },
    { id: 'd', dealName: 'Lanzamiento', client: 'Grupo BTS Foods' },
  ];
  assert.deepEqual(buscarDeals(deals, 'bts').items.map((d) => d.id), ['b', 'a', 'd']);
  assert.deepEqual(buscarDeals(deals, 'COTIZACION').items.map((d) => d.id), ['c']);
  assert.deepEqual(buscarDeals(deals, 'danone bts').items.map((d) => d.id), ['b', 'a']);
  assert.equal(buscarDeals(deals, 'zzz').total, 0);
  assert.equal(buscarDeals(deals, '  ').total, 4, 'sin texto salen todos');
  const muchos = Array.from({ length: 450 }, (_, i) => ({ id: String(i), dealName: `Deal ${i}` }));
  const tope = buscarDeals(muchos, '', 100);
  assert.equal(tope.items.length, 100);
  assert.equal(tope.total, 450, 'el total cuenta todos aunque solo se devuelvan 100');
});

await prueba('la lista para vincular trae todos los deals (también pasados los 500) con su cliente y fase, y un proyecto con un deal reciente no pierde su deal', async () => {
  await pg.query(`insert into deals (deal_name, phase, client) select 'Relleno ' || g, 'Prospecto', 'Cliente ' || g from generate_series(1, 520) g`);
  const dealUltimo = await deal('Deal al final', 70000);
  await pg.query(`update deals set client = 'Cliente Z' where id = $1`, [dealUltimo]);
  const proyectoUltimo = await proyecto('PRB-Z', dealUltimo);
  const r = await analizar([proyectoUltimo]);
  assert.equal(r.projects[0].deal?.dealName, 'Deal al final', 'el deal quedó fuera del análisis');
  const z = r.dealsList.find((d: any) => d.dealName === 'Deal al final');
  assert.ok(z, 'falta el deal en la lista para vincular');
  assert.equal(z.client, 'Cliente Z');
  assert.equal(z.phase, 'Ganado');
  assert.ok(r.dealsList.length > 600, `la lista trae ${r.dealsList.length}`);
});

console.log(`\n${n - fallas} de ${n} pruebas ok`);
if (fallas) process.exit(1);
process.exit(0);
