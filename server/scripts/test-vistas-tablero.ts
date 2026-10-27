// Pruebas de cómo conviven las vistas guardadas del dashboard anterior y las del tablero comercial nuevo (viewId «t2_…») en la misma tabla: cada uno conserva su propia
// vista predeterminada, guardar una no le quita la marca a la otra y lo guardado vuelve tal cual. Contra una base en memoria (PGlite) con el esquema real. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-vistas-tablero.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import saveCommercialView from '../../src/api/saveCommercialView';
import getCommercialViews from '../../src/api/getCommercialViews';
import deleteCommercialView from '../../src/api/deleteCommercialView';

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

const usuario = async (correo: string) => ({ user: { id: (await pg.query<{ id: string }>(`insert into users (email) values ($1) returning id`, [correo])).rows[0].id, email: correo } }) as any;
const ana = await usuario('ana@ejemplo.test');
const luis = await usuario('luis@ejemplo.test');

const TABLERO = JSON.stringify({ v: 2, periodo: { modo: 'anio', anio: 2026 }, bloques: [{ id: 'b1', titulo: 'Ingresos por mes · año completo', tipo: 'barras' }] });
const guardar = (ctx: any, o: { viewId?: string; nombre: string; widgets?: string; fecha?: 'proposalDate' | 'approvalDate'; predeterminada?: boolean }): Promise<{ dbId: string; viewId: string }> =>
  saveCommercialView.run({
    viewId: o.viewId, viewName: o.nombre, filtersJson: o.viewId?.startsWith('t2_') ? '{"v":2}' : '{}', widgetsJson: o.widgets ?? (o.viewId?.startsWith('t2_') ? TABLERO : '[]'),
    dateReference: o.fecha ?? 'approvalDate', isDefault: o.predeterminada,
  } as any, ctx) as any;
const vistas = async (ctx: any) => ((await getCommercialViews.run({} as any, ctx)) as any).views as { viewId: string; viewName: string; isDefault: boolean; widgetsJson: string; dateReference: string }[];
const predeterminadas = async (ctx: any) => (await vistas(ctx)).filter(v => v.isDefault).map(v => v.viewName).sort();

await prueba('guardar la primera vista del tablero como predeterminada no le quita la suya al dashboard anterior', async () => {
  await guardar(ana, { nombre: 'Anual (anterior)', predeterminada: true });
  assert.deepEqual(await predeterminadas(ana), ['Anual (anterior)']);
  await guardar(ana, { viewId: 't2_a', nombre: 'Mi tablero', predeterminada: true });
  assert.deepEqual(await predeterminadas(ana), ['Anual (anterior)', 'Mi tablero']);
});

await prueba('entre vistas del tablero la nueva predeterminada reemplaza a la otra del tablero, no a la del dashboard anterior', async () => {
  await guardar(ana, { viewId: 't2_b', nombre: 'Tablero de ventas', predeterminada: true });
  assert.deepEqual(await predeterminadas(ana), ['Anual (anterior)', 'Tablero de ventas']);
});

await prueba('al revés: la predeterminada nueva del dashboard anterior no toca las del tablero', async () => {
  await guardar(ana, { nombre: 'Trimestral (anterior)', predeterminada: true });
  assert.deepEqual(await predeterminadas(ana), ['Tablero de ventas', 'Trimestral (anterior)']);
});

await prueba('volver a guardar una vista del tablero ya predeterminada la deja igual y sin tocar a las demás', async () => {
  await guardar(ana, { viewId: 't2_b', nombre: 'Tablero de ventas', predeterminada: true });
  assert.deepEqual(await predeterminadas(ana), ['Tablero de ventas', 'Trimestral (anterior)']);
});

await prueba('las predeterminadas de otra persona no se tocan', async () => {
  await guardar(luis, { viewId: 't2_l', nombre: 'Tablero de Luis', predeterminada: true });
  await guardar(luis, { nombre: 'Anual de Luis', predeterminada: true });
  await guardar(ana, { viewId: 't2_c', nombre: 'Tablero de pruebas', predeterminada: true });
  assert.deepEqual(await predeterminadas(luis), ['Anual de Luis', 'Tablero de Luis']);
  assert.deepEqual(await predeterminadas(ana), ['Tablero de pruebas', 'Trimestral (anterior)']);
});

await prueba('lo guardado vuelve tal cual (acentos, comillas y la fecha de referencia) y volver a guardar actualiza en lugar de duplicar', async () => {
  const antes = (await vistas(ana)).length;
  await guardar(ana, { viewId: 't2_d', nombre: 'Por propuesta «2026»', fecha: 'proposalDate', widgets: TABLERO });
  await guardar(ana, { viewId: 't2_d', nombre: 'Por propuesta «2026»', fecha: 'proposalDate', widgets: TABLERO });
  const todas = await vistas(ana);
  assert.equal(todas.length, antes + 1);
  const v = todas.find(x => x.viewId === 't2_d')!;
  assert.equal(v.viewName, 'Por propuesta «2026»');
  assert.equal(v.widgetsJson, TABLERO);
  assert.equal(v.dateReference, 'proposalDate');
  assert.equal(v.isDefault, false);
});

await prueba('borrar una vista del tablero por su viewId deja las demás', async () => {
  await deleteCommercialView.run({ viewId: 't2_d' } as any, ana);
  const ids = (await vistas(ana)).map(v => v.viewId);
  assert.ok(!ids.includes('t2_d'));
  assert.ok(ids.includes('t2_c') && ids.includes('t2_a'));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
