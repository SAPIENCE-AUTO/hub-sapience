// Pruebas de Pilares (unidades de negocio) contra una base en memoria (PGlite) con el esquema real: el catálogo (crear, nombres repetidos, renombrar, desactivar), el reparto de un deal
// entre pilares (ingreso y costo en pesos, validaciones, un solo pilar, quitar pilares, el texto de «Tipo de proyecto» que se reescribe solo), el candado de costos y de administrar
// (solo Owner o Socio), la referencia de costo registrado (órdenes de compra y cotización), la lista para clasificar con sus estados y sugerencias, y las acciones en lote.
// Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pilares.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

process.env.STRICT_OUTPUT = 'true';

const ep = {
  pilares: (await import('../../src/api/getPilares')).default,
  pilar: (await import('../../src/api/savePilar')).default,
  deal: (await import('../../src/api/getDealPilares')).default,
  guardar: (await import('../../src/api/saveDealPilares')).default,
  clasificacion: (await import('../../src/api/getPilaresClasificacion')).default,
  asignar: (await import('../../src/api/assignPilarToDeals')).default,
  aceptar: (await import('../../src/api/acceptPilarSuggestions')).default,
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
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).stack : (e as Error).message.split('\n')[0]}`);
  }
}
const rechaza = (fn: () => Promise<unknown>, texto: string) =>
  assert.rejects(fn, (e: Error) => { assert.ok(e.message.includes(texto), `esperaba «${texto}» y salió «${e.message}»`); return true; });

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

const owner = { user: { id: '00000000-0000-4000-8000-000000000001', email: 'duena@ejemplo.test', role: 'Owner' } };
const socio = { user: { id: '00000000-0000-4000-8000-000000000002', email: 'socio@ejemplo.test', role: 'Socio' } };
const analista = { user: { id: '00000000-0000-4000-8000-000000000003', email: 'analista@ejemplo.test', role: 'Analista' } };
const sinSesion = { user: null };

const crearDeal = async (o: { nombre?: string; precio?: number | null; moneda?: string | null; tipo?: string | null; fase?: string | null; aprobado?: string | null; propuesta?: string | null; tc?: number | null } = {}) =>
  (await pg.query<{ id: string }>(
    `insert into deals (deal_name, client, phase, client_price, currency, project_type, approval_date, proposal_date, exchange_rate) values ($1, 'Cliente Uno', $2, $3, $4, $5, $6, $7, $8) returning id`,
    [o.nombre ?? 'Deal de prueba', o.fase === undefined ? 'Ganado' : o.fase, o.precio === undefined ? 300_000 : o.precio, o.moneda === undefined ? 'MXN 🇲🇽' : o.moneda, o.tipo ?? null, o.aprobado ?? null, o.propuesta ?? null, o.tc ?? null],
  )).rows[0].id;
const tipoDe = async (id: string) => (await pg.query<{ project_type: string | null }>(`select project_type from deals where id = $1`, [id])).rows[0].project_type;
// En el orden del catálogo (no por id: los ids son al azar y la prueba saldría distinta cada vez)
const filasDe = async (id: string) => (await pg.query<{ pilar_id: string; price: number | null; cost: number | null }>(`select dp.pilar_id, dp.price, dp.cost from deal_pilares dp join pilares p on p.id = dp.pilar_id where dp.deal_id = $1 order by p.sort_order`, [id])).rows;
const crear = async (nombre: string, color?: string) => ((await ep.pilar.run({ nombre, color }, owner)) as any).pilar as { id: string; nombre: string; color: string; orden: number; activo: boolean };

// Catálogo de arranque (el mismo que deja el script de creación de tablas)
const CUALI = await crear('Cualitativo');
const CUANTI = await crear('Cuantitativo');
const DIGITAL = await crear('Digital');
const ESTRATEGIA = await crear('Estrategia');

// ── Catálogo ────────────────────────────────────────────────────────────────

await prueba('crear pilares: nombre limpio, color de la paleta sin repetir y orden consecutivo', async () => {
  assert.deepEqual([CUALI, CUANTI, DIGITAL, ESTRATEGIA].map(p => p.orden), [1, 2, 3, 4]);
  assert.equal(new Set([CUALI, CUANTI, DIGITAL, ESTRATEGIA].map(p => p.color)).size, 4);
  assert.ok([CUALI, CUANTI, DIGITAL, ESTRATEGIA].every(p => p.activo && /^#[0-9A-Fa-f]{6}$/.test(p.color)));
  const raro = await crear('   Investigación   de   mercado  ', '#112233');
  assert.equal(raro.nombre, 'Investigación de mercado');
  assert.equal(raro.color, '#112233');
  assert.equal(raro.orden, 5);
  await ep.pilar.run({ id: raro.id, activo: false }, owner);
  await ep.pilar.run({ id: raro.id, nombre: 'Investigación de mercado' }, owner); // sin cambios
});

await prueba('un nombre repetido no entra, sin importar mayúsculas, acentos ni espacios (ni estando desactivado el otro)', async () => {
  for (const repetido of ['cualitativo', '  CUALITATIVO  ', 'Cualitatívo']) await rechaza(() => crear(repetido), 'Ya existe un pilar llamado «Cualitativo»');
  await rechaza(() => crear('investigacion de mercado'), 'está desactivado');
});

await prueba('nombres que no sirven: vacío, de una letra o larguísimo; colores que no son #RRGGBB', async () => {
  await rechaza(() => crear(''), 'Falta el nombre del pilar');
  await rechaza(() => crear('   '), 'entre 2 y 40 letras');
  await rechaza(() => crear('A'), 'entre 2 y 40 letras');
  await rechaza(() => crear('x'.repeat(41)), 'entre 2 y 40 letras');
  await rechaza(() => crear('Con color malo', 'rojo'), 'color debe venir como #RRGGBB');
  await rechaza(() => ep.pilar.run({}, owner), 'Falta el nombre');
});

await prueba('desactivar y reactivar: queda en el catálogo, ya no se puede asignar a deals nuevos, pero un deal que ya lo traía lo sigue guardando', async () => {
  const temporal = await crear('Temporal');
  const dealNuevo = await crearDeal({ nombre: 'Deal nuevo' });
  const dealViejo = await crearDeal({ nombre: 'Deal viejo' });
  await ep.guardar.run({ dealId: dealViejo, items: [{ pilarId: temporal.id, precio: null, costo: null }] }, owner);
  const apagado = ((await ep.pilar.run({ id: temporal.id, activo: false }, owner)) as any).pilar;
  assert.equal(apagado.activo, false);
  assert.ok(((await ep.pilares.run({}, analista)) as any).pilares.some((p: any) => p.id === temporal.id && !p.activo));
  await rechaza(() => ep.guardar.run({ dealId: dealNuevo, items: [{ pilarId: temporal.id, precio: null, costo: null }] }, owner), 'está desactivado');
  await ep.guardar.run({ dealId: dealViejo, items: [{ pilarId: temporal.id, precio: null, costo: 10 }] }, owner); // sigue pudiendo editarse
  const prendido = ((await ep.pilar.run({ id: temporal.id, activo: true }, owner)) as any).pilar;
  assert.equal(prendido.activo, true);
  await ep.guardar.run({ dealId: dealNuevo, items: [{ pilarId: temporal.id, precio: null, costo: null }] }, owner);
});

await prueba('renombrar un pilar reescribe el «Tipo de proyecto» de los deals que lo tienen, y no deja chocar con otro nombre', async () => {
  const a = await crear('Experiencia');
  const d = await crearDeal({ nombre: 'Deal con Experiencia' });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: a.id, precio: 100_000, costo: null }, { pilarId: DIGITAL.id, precio: 200_000, costo: null }] }, owner);
  assert.equal(await tipoDe(d), 'Digital + Experiencia'.split(' + ').sort((x, y) => (x === 'Experiencia' ? 1 : -1) - (y === 'Experiencia' ? 1 : -1)).join(' + '));
  const nuevo = ((await ep.pilar.run({ id: a.id, nombre: 'Experiencia de usuario', color: '#334455' }, owner)) as any).pilar;
  assert.deepEqual([nuevo.nombre, nuevo.color], ['Experiencia de usuario', '#334455']);
  assert.equal(await tipoDe(d), 'Digital + Experiencia de usuario');
  await rechaza(() => ep.pilar.run({ id: a.id, nombre: 'digital' }, owner), 'Ya existe un pilar llamado «Digital»');
  await rechaza(() => ep.pilar.run({ id: '00000000-0000-4000-8000-0000000000ff', nombre: 'Fantasma' }, owner), 'Pilar no encontrado');
});

await prueba('administrar el catálogo es de Owner o Socio; verlo, de cualquiera con sesión', async () => {
  await ep.pilar.run({ nombre: 'Lo crea un socio' }, socio);
  await rechaza(() => ep.pilar.run({ nombre: 'Lo intenta una analista' }, analista), 'Solo Owner o Socio');
  await rechaza(() => ep.pilar.run({ id: CUALI.id, activo: false }, analista), 'Solo Owner o Socio');
  assert.ok(((await ep.pilares.run({}, analista)) as any).pilares.length >= 4);
  await rechaza(() => ep.pilares.run({}, sinSesion), 'Sesión requerida');
});

// ── Reparto de un deal ──────────────────────────────────────────────────────

await prueba('un solo pilar: su ingreso queda vacío (vale el precio del deal), el deal sale listo y su «Tipo de proyecto» pasa a ser el nombre del pilar', async () => {
  const d = await crearDeal({ precio: 300_000, tipo: 'Tipo de proyecto' });
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 999, costo: 50_000 }] }, owner);
  assert.deepEqual(r.items, [{ pilarId: CUALI.id, precio: null, costo: 50_000 }]);
  assert.deepEqual(r.resumen, { estado: 'listo', asignado: 300_000, falta: 0, sobra: 0 });
  assert.equal(await tipoDe(d), 'Cualitativo');
  assert.deepEqual((await filasDe(d)).map(x => [x.price, x.cost]), [[null, 50_000]]);
});

await prueba('dos pilares que suman el precio: listo, con el texto «Cualitativo + Digital» en el orden del catálogo', async () => {
  const d = await crearDeal({ precio: 300_000 });
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: DIGITAL.id, precio: 90_000, costo: 40_000 }, { pilarId: CUALI.id, precio: 210_000, costo: 120_000 }] }, owner);
  assert.equal(r.resumen.estado, 'listo');
  assert.deepEqual(r.items.map((i: any) => [i.pilarId, i.precio, i.costo]), [[CUALI.id, 210_000, 120_000], [DIGITAL.id, 90_000, 40_000]], 'vuelven en el orden del catálogo');
  assert.equal(await tipoDe(d), 'Cualitativo + Digital');
});

await prueba('pasarse del precio se rechaza en claro y no cambia nada de lo que ya estaba guardado', async () => {
  const d = await crearDeal({ precio: 300_000 });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: null }, { pilarId: DIGITAL.id, precio: 100_000, costo: null }] }, owner);
  await rechaza(
    () => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 250_000, costo: null }, { pilarId: DIGITAL.id, precio: 100_000, costo: null }] }, owner),
    'El reparto suma $350,000 y el precio del deal es $300,000: se pasa por $50,000.',
  );
  assert.deepEqual((await filasDe(d)).map(x => Number(x.price)).sort(), [100_000, 200_000]);
});

await prueba('repartir de menos se permite (queda «incompleto» con lo que falta); con un peso de diferencia todavía cuenta como completo', async () => {
  const d = await crearDeal({ precio: 300_000 });
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: null }, { pilarId: DIGITAL.id, precio: 50_000, costo: null }] }, owner);
  assert.deepEqual(r.resumen, { estado: 'incompleto', asignado: 250_000, falta: 50_000, sobra: 0 });
  const ok: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: null }, { pilarId: DIGITAL.id, precio: 99_999.5, costo: null }] }, owner);
  assert.equal(ok.resumen.estado, 'listo');
});

await prueba('un deal sin precio se puede repartir (queda «sin precio», no se valida contra nada)', async () => {
  const d = await crearDeal({ precio: null });
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 10, costo: null }, { pilarId: DIGITAL.id, precio: 5, costo: null }] }, owner);
  assert.equal(r.resumen.estado, 'sin-precio');
});

await prueba('los montos se redondean a centavos y se guardan exactos', async () => {
  const d = await crearDeal({ precio: 100 });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 33.335, costo: 10.004 }, { pilarId: DIGITAL.id, precio: 66.66, costo: 0.005 }] }, owner);
  assert.deepEqual((await filasDe(d)).map(x => [x.price, x.cost]), [[33.34, 10], [66.66, 0.01]]);
});

await prueba('quitar un pilar borra su fila y el texto se actualiza; con un solo pilar su ingreso se vacía', async () => {
  const d = await crearDeal({ precio: 300_000 });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: null }, { pilarId: DIGITAL.id, precio: 100_000, costo: null }] }, owner);
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: null }] }, owner);
  assert.deepEqual(r.items.map((i: any) => i.pilarId), [CUALI.id]);
  assert.equal(r.items[0].precio, null);
  assert.equal(await tipoDe(d), 'Cualitativo');
  assert.equal((await filasDe(d)).length, 1);
});

await prueba('un reparto vacío lo borra todo y deja el «Tipo de proyecto» como estaba', async () => {
  const d = await crearDeal({ tipo: 'Texto de antes' });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: null, costo: null }] }, owner);
  assert.equal(await tipoDe(d), 'Cualitativo');
  const r: any = await ep.guardar.run({ dealId: d, items: [] }, owner);
  assert.deepEqual(r.items, []);
  assert.equal(r.resumen.estado, 'sin-clasificar');
  assert.equal((await filasDe(d)).length, 0);
  assert.equal(await tipoDe(d), 'Cualitativo', 'no se borra el texto');
});

await prueba('entradas que no valen: pilar repetido, pilar que no existe, montos negativos o de texto, deal que no existe o con id malo', async () => {
  const d = await crearDeal();
  await rechaza(() => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 1, costo: null }, { pilarId: CUALI.id, precio: 2, costo: null }] }, owner), 'solo puede aparecer una vez');
  await rechaza(() => ep.guardar.run({ dealId: d, items: [{ pilarId: '00000000-0000-4000-8000-0000000000fe', precio: null, costo: null }] }, owner), 'ya no existe');
  await rechaza(() => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: -5, costo: null }] }, owner), 'monto de cero en adelante');
  await rechaza(() => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: null, costo: -1 }] }, owner), 'monto de cero en adelante');
  await rechaza(() => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 'mucho' as unknown as number, costo: null }] }, owner), 'precio');
  await rechaza(() => ep.guardar.run({ dealId: '00000000-0000-4000-8000-0000000000fd', items: [] }, owner), 'Deal no encontrado');
  await rechaza(() => ep.guardar.run({ dealId: 'no-es-un-id', items: [] }, owner), 'Identificador no válido');
  assert.equal((await filasDe(d)).length, 0);
});

await prueba('un deal en dólares avisa en dólares', async () => {
  const d = await crearDeal({ precio: 1000, moneda: 'USD 🇺🇸' });
  await rechaza(
    () => ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 800, costo: null }, { pilarId: DIGITAL.id, precio: 300, costo: null }] }, owner),
    'suma USD 1,100 y el precio del deal es USD 1,000: se pasa por USD 100',
  );
  const r: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 800, costo: null }, { pilarId: DIGITAL.id, precio: 200, costo: null }] }, owner);
  assert.equal(r.deal.moneda, 'USD');
});

// ── Costos: solo Owner o Socio ──────────────────────────────────────────────

await prueba('quien no es Owner ni Socio reparte el ingreso pero no ve ni cambia costos: los que ya había se conservan', async () => {
  const d = await crearDeal({ precio: 300_000 });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 200_000, costo: 70_000 }, { pilarId: DIGITAL.id, precio: 100_000, costo: 20_000 }] }, owner);
  const vistaAnalista: any = await ep.deal.run({ dealId: d }, analista);
  assert.equal(vistaAnalista.veCostos, false);
  assert.equal(vistaAnalista.referencias, null);
  assert.deepEqual(vistaAnalista.items.map((i: any) => i.costo), [null, null]);
  assert.deepEqual(vistaAnalista.items.map((i: any) => i.precio), [200_000, 100_000]);
  const guardado: any = await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 150_000, costo: 999 }, { pilarId: DIGITAL.id, precio: 150_000, costo: null }] }, analista);
  assert.deepEqual(guardado.items.map((i: any) => i.costo), [null, null], 'ni siquiera se le devuelven');
  assert.deepEqual((await filasDe(d)).map(x => [Number(x.price), Number(x.cost)]), [[150_000, 70_000], [150_000, 20_000]], 'precio sí cambió; costos intactos');
  const vistaOwner: any = await ep.deal.run({ dealId: d }, socio);
  assert.equal(vistaOwner.veCostos, true);
  assert.deepEqual(vistaOwner.items.map((i: any) => i.costo), [70_000, 20_000]);
});

await prueba('un pilar nuevo que agrega quien no ve costos entra sin costo', async () => {
  const d = await crearDeal({ precio: 300_000 });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: null, costo: 5 }] }, analista);
  assert.deepEqual((await filasDe(d)).map(x => x.cost), [null]);
});

await prueba('referencias de costo del deal: lo gastado (sin borradores ni canceladas) y lo cotizado (solo cotizaciones incluidas); vacío si no hay', async () => {
  const d = await crearDeal({ nombre: 'Deal con costos' });
  const vacio: any = await ep.deal.run({ dealId: d }, owner);
  assert.deepEqual(vacio.referencias, { real: null, cotizado: null, otraMoneda: false });
  await pg.query(`insert into projects (project_code, full_name, status, deal_vinculado_id) values ('PROY-A', 'Proyecto A', 'En curso', $1)`, [d]);
  const asignado = await crearDeal({ nombre: 'Otro deal' });
  await pg.query(`insert into projects (project_code, full_name, status, deal_asignado_id) values ('PROY-B', 'Proyecto B', 'En curso', $1)`, [d]);
  await pg.query(`insert into projects (project_code, full_name, status, deal_vinculado_id) values ('PROY-C', 'Proyecto C', 'En curso', $1)`, [asignado]);
  for (const [code, monto, estado, moneda] of [
    ['PROY-A', 1000, 'Aprobada', 'MXN'], ['PROY-A', 500, 'Cancelada', 'MXN'], ['PROY-A', 700, 'Borrador', 'MXN'], ['PROY-B', 250.5, 'Pagada', 'MXN'], ['PROY-C', 9999, 'Pagada', 'MXN'],
  ] as const) await pg.query(`insert into purchase_orders (po_number, project_code, total_amount, status, currency) values ($1, $2, $3, $4, $5)`, [`OC-${code}-${monto}`, code, monto, estado, moneda]);
  const cot = (await pg.query<{ id: string }>(`insert into cotizaciones (cotizacion_name, deal_id, status, included) values ('Cotización incluida', $1, 'Borrador', true) returning id`, [d])).rows[0].id;
  const fuera = (await pg.query<{ id: string }>(`insert into cotizaciones (cotizacion_name, deal_id, status, included) values ('Cotización descartada', $1, 'Borrador', false) returning id`, [d])).rows[0].id;
  await pg.query(`insert into cotizacion_line_items (sub_rubro, cotizacion_id, rubro, cantidad, unit_cost, componentes) values ('moderación', $1, 'Moderación', 2, 100, 3), ('incentivos', $1, 'Reclutamiento e incentivos', 4, 50, null)`, [cot]);
  await pg.query(`insert into cotizacion_line_items (sub_rubro, cotizacion_id, rubro, cantidad, unit_cost) values ('no cuenta', $1, 'Back office', 1, 1000000)`, [fuera]);
  const r: any = await ep.deal.run({ dealId: d }, owner);
  assert.deepEqual(r.referencias, { real: 1250.5, cotizado: 800, otraMoneda: false }, 'gastado 1000 + 250.5; cotizado 2×100×3 + 4×50×1');
  await pg.query(`insert into purchase_orders (po_number, project_code, total_amount, status, currency) values ('OC-USD', 'PROY-A', 10, 'Aprobada', 'USD')`);
  assert.equal(((await ep.deal.run({ dealId: d }, owner)) as any).referencias.otraMoneda, true, 'avisa que hay órdenes en dólares sumadas sin convertir');
});

// ── Sugerencias del texto viejo ─────────────────────────────────────────────

await prueba('un deal sin reparto trae la sugerencia de su texto viejo; con reparto ya no', async () => {
  const d = await crearDeal({ tipo: 'Cuali + Digital' });
  const antes: any = await ep.deal.run({ dealId: d }, analista);
  assert.deepEqual(antes.sugerencia, { pilarIds: [CUALI.id, DIGITAL.id], nombres: ['Cualitativo', 'Digital'], mixta: true });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: 100_000, costo: null }, { pilarId: DIGITAL.id, precio: 200_000, costo: null }] }, owner);
  assert.equal(((await ep.deal.run({ dealId: d }, analista)) as any).sugerencia, null);
  const sinPista = await crearDeal({ tipo: 'Tipo de proyecto' });
  assert.equal(((await ep.deal.run({ dealId: sinPista }, analista)) as any).sugerencia, null);
});

// ── Lista para clasificar ───────────────────────────────────────────────────

await prueba('la lista trae cada deal con su estado, su fecha y su sugerencia; solo Owner o Socio la piden', async () => {
  await pg.exec(`delete from deals`);
  const sin = await crearDeal({ nombre: 'Sin nada', tipo: 'Tipo de proyecto', aprobado: '2026-03-10' });
  const claro = await crearDeal({ nombre: 'Texto claro', tipo: 'CUALITATIVO', propuesta: '2025-07-01' });
  const mixto = await crearDeal({ nombre: 'Texto mixto', tipo: 'Cuali + estrategia', precio: 100 });
  const listo = await crearDeal({ nombre: 'Ya repartido', precio: 1000 });
  const incompleto = await crearDeal({ nombre: 'Incompleto', precio: 1000 });
  const excedido = await crearDeal({ nombre: 'Se pasó', precio: 1000 });
  const sinPrecio = await crearDeal({ nombre: 'Sin precio', precio: null });
  await ep.guardar.run({ dealId: listo, items: [{ pilarId: CUALI.id, precio: 600, costo: null }, { pilarId: DIGITAL.id, precio: 400, costo: null }] }, owner);
  await ep.guardar.run({ dealId: incompleto, items: [{ pilarId: CUALI.id, precio: 600, costo: null }, { pilarId: DIGITAL.id, precio: 100, costo: null }] }, owner);
  await ep.guardar.run({ dealId: excedido, items: [{ pilarId: CUALI.id, precio: 600, costo: null }, { pilarId: DIGITAL.id, precio: 400, costo: null }] }, owner);
  await pg.query(`update deals set client_price = 500 where id = $1`, [excedido]); // el precio bajó después de repartir
  await ep.guardar.run({ dealId: sinPrecio, items: [{ pilarId: CUALI.id, precio: 1, costo: null }, { pilarId: DIGITAL.id, precio: 2, costo: null }] }, owner);

  const r: any = await ep.clasificacion.run({}, socio);
  const por = Object.fromEntries(r.deals.map((d: any) => [d.nombre, d]));
  assert.equal(r.deals.length, 7);
  assert.equal(por['Sin nada'].estado, 'sin-clasificar');
  assert.equal(por['Sin nada'].sugerencia, null);
  assert.equal(por['Sin nada'].fecha, '2026-03-10');
  assert.equal(por['Texto claro'].estado, 'sin-clasificar');
  assert.deepEqual(por['Texto claro'].sugerencia, { pilarIds: [CUALI.id], nombres: ['Cualitativo'], mixta: false });
  assert.equal(por['Texto claro'].fecha, '2025-07-01', 'sin fecha de aprobación se usa la de propuesta');
  assert.deepEqual(por['Texto mixto'].sugerencia, { pilarIds: [CUALI.id, ESTRATEGIA.id], nombres: ['Cualitativo', 'Estrategia'], mixta: true });
  assert.equal(por['Ya repartido'].estado, 'listo');
  assert.equal(por['Ya repartido'].sugerencia, null);
  assert.deepEqual([por['Incompleto'].estado, por['Incompleto'].falta], ['incompleto', 300]);
  assert.deepEqual([por['Se pasó'].estado, por['Se pasó'].sobra], ['excedido', 500]);
  assert.equal(por['Sin precio'].estado, 'sin-precio');
  assert.equal(por['Texto mixto'].moneda, 'MXN');
  assert.equal(r.pilares.length >= 4, true);
  await rechaza(() => ep.clasificacion.run({}, analista), 'Solo Owner o Socio');
});

// ── Acciones en lote ────────────────────────────────────────────────────────

await prueba('poner un pilar a varios deals: solo a los que no tienen reparto; el texto de «Tipo de proyecto» se actualiza', async () => {
  await pg.exec(`delete from deals`);
  const a = await crearDeal({ nombre: 'A', tipo: 'Tipo de proyecto' });
  const b = await crearDeal({ nombre: 'B', tipo: '' });
  const yaTiene = await crearDeal({ nombre: 'Ya tiene' });
  await ep.guardar.run({ dealId: yaTiene, items: [{ pilarId: DIGITAL.id, precio: null, costo: 5 }] }, owner);
  const r: any = await ep.asignar.run({ dealIds: [a, b, yaTiene, a, '00000000-0000-4000-8000-0000000000aa'], pilarId: CUANTI.id }, owner);
  assert.deepEqual(r, { asignados: 2, omitidos: 2 }, 'A y B; el que ya tenía y el que no existe se omiten; el repetido cuenta una vez');
  assert.deepEqual([await tipoDe(a), await tipoDe(b), await tipoDe(yaTiene)], ['Cuantitativo', 'Cuantitativo', 'Digital']);
  assert.deepEqual((await filasDe(a)).map(x => [x.pilar_id, x.price, x.cost]), [[CUANTI.id, null, null]]);
  assert.deepEqual((await filasDe(yaTiene)).map(x => x.cost), [5], 'lo que ya tenía no se toca');
  await rechaza(() => ep.asignar.run({ dealIds: [a], pilarId: '00000000-0000-4000-8000-0000000000ab' }, owner), 'Pilar no encontrado');
  await ep.pilar.run({ id: CUANTI.id, activo: false }, owner);
  await rechaza(() => ep.asignar.run({ dealIds: [a], pilarId: CUANTI.id }, owner), 'está desactivado');
  await ep.pilar.run({ id: CUANTI.id, activo: true }, owner);
  assert.deepEqual(await ep.asignar.run({ dealIds: [], pilarId: CUANTI.id }, owner), { asignados: 0, omitidos: 0 });
  await rechaza(() => ep.asignar.run({ dealIds: [a], pilarId: DIGITAL.id }, analista), 'Solo Owner o Socio');
});

await prueba('aceptar sugerencias: las de un solo pilar se aceptan; las que mezclan se dejan para repartirlas a mano; lo que no se reconoce y lo ya repartido se omite', async () => {
  await pg.exec(`delete from deals`);
  const c1 = await crearDeal({ nombre: 'Cuali 1', tipo: 'Cuali' });
  const c2 = await crearDeal({ nombre: 'Cuali 2', tipo: 'CUALITATIVO' });
  const dg = await crearDeal({ nombre: 'Digital', tipo: 'Digital' });
  const mx = await crearDeal({ nombre: 'Mixto', tipo: 'Cuali + Digital' });
  const raro = await crearDeal({ nombre: 'Raro', tipo: 'Entendimiento de Consumidor' });
  const ya = await crearDeal({ nombre: 'Ya repartido', tipo: 'Cuali' });
  await ep.guardar.run({ dealId: ya, items: [{ pilarId: ESTRATEGIA.id, precio: null, costo: null }] }, owner);
  const r: any = await ep.aceptar.run({ dealIds: [c1, c2, dg, mx, raro, ya] }, owner);
  assert.deepEqual(r, { aceptados: 3, omitidos: 2, mixtos: 1 });
  assert.deepEqual([await tipoDe(c1), await tipoDe(c2), await tipoDe(dg)], ['Cualitativo', 'Cualitativo', 'Digital']);
  assert.equal((await filasDe(mx)).length, 0, 'el mixto no se toca');
  assert.equal((await filasDe(raro)).length, 0);
  assert.deepEqual((await filasDe(ya)).map(x => x.pilar_id), [ESTRATEGIA.id], 'el ya repartido se queda como estaba');
  await rechaza(() => ep.aceptar.run({ dealIds: [c1] }, analista), 'Solo Owner o Socio');
  assert.deepEqual(await ep.aceptar.run({ dealIds: [] }, owner), { aceptados: 0, omitidos: 0, mixtos: 0 });
});

// ── El esquema ──────────────────────────────────────────────────────────────

await prueba('borrar un deal borra su reparto; borrar un pilar que ya se usó no se deja; un pilar aparece una vez por deal', async () => {
  const d = await crearDeal({ nombre: 'Para borrar' });
  await ep.guardar.run({ dealId: d, items: [{ pilarId: CUALI.id, precio: null, costo: null }] }, owner);
  await assert.rejects(() => pg.query(`insert into deal_pilares (deal_id, pilar_id) values ($1, $2)`, [d, CUALI.id]), /duplicate key|unique/i);
  await assert.rejects(() => pg.query(`delete from pilares where id = $1`, [CUALI.id]), /foreign key|violates/i);
  await pg.query(`delete from deals where id = $1`, [d]);
  assert.equal((await filasDe(d)).length, 0);
  const otro = await crearDeal();
  await assert.rejects(() => pg.query(`insert into deal_pilares (deal_id, pilar_id, price) values ($1, $2, -1)`, [otro, CUALI.id]), /check|violates/i);
  await assert.rejects(() => pg.query(`insert into pilares (name) values ('   ')`), /check|violates/i);
  await assert.rejects(() => pg.query(`insert into pilares (name, color) values ('Color malo', 'azul')`), /check|violates/i);
});

await prueba('el script que crea las tablas en producción deja exactamente lo mismo que schema.sql (columnas, restricciones, índices, trigger) y se puede correr dos veces', async () => {
  const { crearTablasPilares } = await import('./add-pilares-tables');
  const completo = fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, '');
  // schema.sql SIN las dos tablas de Pilares: la base «de antes», sobre la que correría el script
  const sinPilares = completo
    .replace(/create table pilares \([\s\S]*?\n\);\ncreate trigger pilares_set_updated[^\n]*\n/, '')
    .replace(/create table deal_pilares \([\s\S]*?\n\);\ncreate trigger deal_pilares_set_updated[^\n]*\n/, '')
    .replace(/create unique index pilares_name_uniq[^\n]*\n/, '')
    .replace(/create unique index deal_pilares_deal_pilar_uniq[^\n]*\n/, '')
    .replace(/create index on deal_pilares \(pilar_id\);\n/, '');
  assert.ok(!/create table (deal_)?pilares/.test(sinPilares), 'la base de antes no debe traer las tablas');
  const otra = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
  await otra.exec(sinPilares);
  const bd = { query: (sql: string, params?: unknown[]) => otra.query(sql, params as any) };
  const primera = await crearTablasPilares(bd);
  const segunda = await crearTablasPilares(bd);
  assert.equal(primera.sembrados, 4);
  assert.equal(segunda.sembrados, 0, 'la segunda vez no siembra nada');
  assert.deepEqual((await otra.query<{ name: string }>(`select name from pilares order by sort_order`)).rows.map(r => r.name), ['Cualitativo', 'Cuantitativo', 'Digital', 'Estrategia']);

  const huella = async (base: PGlite) => ({
    columnas: (await base.query(`select table_name, column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale from information_schema.columns where table_name in ('pilares', 'deal_pilares') order by table_name, ordinal_position`)).rows,
    restricciones: (await base.query(`select conrelid::regclass::text as tabla, conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid in ('pilares'::regclass, 'deal_pilares'::regclass) order by 1, 2`)).rows,
    indices: (await base.query(`select indexname, indexdef from pg_indexes where tablename in ('pilares', 'deal_pilares') order by indexname`)).rows,
    triggers: (await base.query(`select tgname from pg_trigger where tgrelid in ('pilares'::regclass, 'deal_pilares'::regclass) and not tgisinternal order by tgname`)).rows,
  });
  assert.deepEqual(await huella(otra), await huella(pg));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
