// Pruebas de las facturas de proveedores contra una base en memoria (PGlite) con el esquema real: que la factura subida desde el portal guarde el número y el
// proyecto de su OC (desde el 16-ago-2026 se guardaban vacíos) y que la lista «Facturas de proveedores» complete el número de ODC y el proyecto de TODAS las
// facturas, también cuando hay más de 500 OCs distintas (la lista pedía solo 500 al azar y a las demás les faltaba el número). Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-facturas-proveedor.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import uploadSupplierInvoice from '../../src/api/uploadSupplierInvoice';
import getSupplierInvoices from '../../src/api/getSupplierInvoices';
import getSupplierInvoiceById from '../../src/api/getSupplierInvoiceById';
import reviewSupplierInvoice from '../../src/api/reviewSupplierInvoice';

/** Los endpoints escriben bitácora con console.log: en las pruebas se calla para que se lea el resultado. */
const sinBitacora = async <T>(f: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try { return await f(); } finally { console.log = original; }
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

const id = async (sql: string, params: unknown[]) => (await pg.query<{ id: string }>(`${sql} returning id`, params as any)).rows[0].id;
const ctxInterno = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
const ctxPublico = { user: null } as any;

// Un proveedor con su token y su clave, y una OC suya.
await pg.query(`insert into suppliers (supplier_name, email, access_token, portal_password) values ('Proveedora Uno', 'uno@ejemplo.test', 'token-uno', 'clave-uno')`);
await pg.query(`insert into suppliers (supplier_name, email, access_token, portal_password) values ('Proveedor Dos', 'dos@ejemplo.test', 'token-dos', 'clave-dos')`);
const ocUno = await id(`insert into purchase_orders (po_number, project_code, supplier_name, status, total_amount, currency) values ('RI-00001', 'PROYECTO-A', 'Proveedora Uno', 'Aprobada', 1000, 'MXN')`, []);

const subir = (poId: string, token: string, password: string) =>
  sinBitacora(() => uploadSupplierInvoice.run({
    token, password, poId, invoiceNumber: 'F-1', amount: 1160, currency: 'MXN', subtotal: 1000, ivaRate: 0.16, ivaAmount: 160,
    pdfFile: [{ url: 'https://ejemplo.test/factura.pdf' }],
  }, ctxPublico)) as Promise<{ success: boolean; id: string }>;

await prueba('la factura que sube el proveedor se guarda con el número de su OC y su proyecto (desde el 16-ago se guardaban vacíos)', async () => {
  const r = await subir(ocUno, 'token-uno', 'clave-uno');
  assert.equal(r.success, true);
  const f = (await pg.query<any>(`select po_id, po_number, project_code, supplier_name, status, amount from supplier_invoices where id = $1`, [r.id])).rows[0];
  assert.deepEqual([f.po_id, f.po_number, f.project_code, f.supplier_name, f.status], [ocUno, 'RI-00001', 'PROYECTO-A', 'Proveedora Uno', 'Pendiente']);
  assert.equal(Number(f.amount), 1160);
});
await prueba('una OC de otro proveedor, o una clave equivocada, se rechazan y no se guarda nada', async () => {
  const antes = (await pg.query<any>(`select count(*)::int n from supplier_invoices`)).rows[0].n;
  await assert.rejects(() => subir(ocUno, 'token-dos', 'clave-dos'), /no corresponde a este proveedor/);
  await assert.rejects(() => subir(ocUno, 'token-uno', 'clave-mala'), /Clave de acceso incorrecta/);
  assert.equal((await pg.query<any>(`select count(*)::int n from supplier_invoices`)).rows[0].n, antes);
});

// 620 OCs distintas, cada una con una factura guardada SIN número ni proyecto (como las del 16-ago en adelante): la lista debe completarlas todas.
await pg.query(`
  insert into purchase_orders (po_number, project_code, supplier_name, status, total_amount, currency)
  select 'RI-' || lpad(g::text, 5, '0'), 'PROYECTO-' || (g % 7), 'Proveedora Uno', 'Aprobada', 1000 + g, 'MXN' from generate_series(100, 719) g`);
await pg.query(`
  insert into supplier_invoices (invoice_number, po_id, supplier_name, po_number, project_code, amount, currency, status, upload_date)
  select 'F-' || p.po_number, p.id::text, 'Proveedora Uno', '', '', 1160, 'MXN', 'Validada', now() - (random() * interval '60 days') from purchase_orders p where p.po_number <> 'RI-00001'`);
const lista: any = await sinBitacora(() => getSupplierInvoices.run({}, ctxInterno));

await prueba('la lista completa el número de ODC de TODAS las facturas aunque haya más de 500 OCs distintas (antes se perdían al azar)', () => {
  assert.equal(lista.invoices.length, 621);
  const sinOdc = lista.invoices.filter((i: any) => !i.poNumber);
  assert.equal(sinOdc.length, 0, `${sinOdc.length} facturas sin número de ODC`);
  // y cada una trae el número de SU OC, no el de otra
  for (const i of lista.invoices.slice(0, 50)) assert.equal(i.invoiceNumber === 'F-1' ? 'RI-00001' : i.invoiceNumber.replace('F-', ''), i.poNumber);
});
await prueba('la lista completa también el proyecto, y los datos de la OC (monto, condiciones), de todas', () => {
  const sinProyecto = lista.invoices.filter((i: any) => !i.projectCode);
  assert.equal(sinProyecto.length, 0, `${sinProyecto.length} facturas sin proyecto`);
  const sinMonto = lista.invoices.filter((i: any) => i.poTotalAmount === undefined);
  assert.equal(sinMonto.length, 0, `${sinMonto.length} facturas sin datos de su OC`);
});
await prueba('filtrar por proyecto encuentra las facturas aunque se hayan guardado sin él', async () => {
  const r: any = await sinBitacora(() => getSupplierInvoices.run({ projectCode: 'PROYECTO-3' }, ctxInterno));
  assert.ok(r.invoices.length > 80, `solo ${r.invoices.length}`);
  assert.ok(r.invoices.every((i: any) => i.projectCode === 'PROYECTO-3'));
});

// ── Revisión y detalle de una factura guardada sin número ni proyecto (las del 16-ago en adelante) ──────────────────────────────────────────────────
// Al validar se crea el pago programado con el proyecto de la factura: si no lo traía, el pago quedaba sin proyecto (437 pagos desde esa fecha).
const ocTres = await id(`insert into purchase_orders (po_number, project_code, supplier_name, status, total_amount, currency) values ('RI-00800', 'PROYECTO-Z', 'Proveedora Uno', 'Aprobada', 2000, 'MXN')`, []);
const facturaSinProyecto = await id(
  `insert into supplier_invoices (invoice_number, po_id, supplier_name, po_number, project_code, amount, currency, status, upload_date) values ('F-800', $1, 'Proveedora Uno', '', '', 2320, 'MXN', 'Pendiente', now())`, [ocTres]);
const facturaConProyecto = await id(
  `insert into supplier_invoices (invoice_number, po_id, supplier_name, po_number, project_code, amount, currency, status, upload_date) values ('F-801', $1, 'Proveedora Uno', 'RI-00800', 'PROYECTO-F', 1160, 'MXN', 'Pendiente', now())`, [ocTres]);
const pagoDe = async (paymentId: string) =>
  (await pg.query<any>(`select type, po_id, project_code, status, amount, supplier_invoice_number from payments where id = $1`, [paymentId])).rows[0];

await prueba('el detalle de una factura guardada sin número ni proyecto muestra los de su OC', async () => {
  const r: any = await sinBitacora(() => getSupplierInvoiceById.run({ invoiceId: facturaSinProyecto }, ctxInterno));
  assert.equal(r.invoice.poNumber, 'RI-00800');
  assert.equal(r.invoice.projectCode, 'PROYECTO-Z');
});
await prueba('al validar una factura guardada sin proyecto, el pago programado toma el proyecto de su OC', async () => {
  const r: any = await sinBitacora(() => reviewSupplierInvoice.run({ invoiceId: facturaSinProyecto, action: 'validar', scheduledPaymentDate: '2026-12-15' }, ctxInterno));
  assert.equal(r.success, true);
  const p = await pagoDe(r.paymentId);
  assert.deepEqual([p.type, p.po_id, p.project_code, p.status, Number(p.amount), p.supplier_invoice_number], ['Pago a proveedor', ocTres, 'PROYECTO-Z', 'Programado', 2320, 'F-800']);
});
await prueba('si la factura sí trae proyecto, el pago usa el de la factura (no el de la OC)', async () => {
  const r: any = await sinBitacora(() => reviewSupplierInvoice.run({ invoiceId: facturaConProyecto, action: 'validar', scheduledPaymentDate: '2026-12-15' }, ctxInterno));
  assert.equal((await pagoDe(r.paymentId)).project_code, 'PROYECTO-F');
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
