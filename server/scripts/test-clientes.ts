// Pruebas del catálogo de clientes (razones sociales, condiciones de cobro y contactos) y de cómo Cobranza lo usa, contra una base en memoria (PGlite) con el esquema real.
// Lo que cuidan: la validación y limpieza de los datos fiscales (RFC, código postal, correos, catálogos del SAT), que un RFC no se repita dentro del cliente, que desactivar una razón social
// no la borre ni se reactive sola, el candado (solo Owner o Finanzas), los conteos del catálogo, y la pieza que se rompió en producción: arrancar un proceso de cobranza ya no depende
// de una columna de días de crédito en `clients`, sino de la razón social (cliente, razón social y pasos que aplican quedan en el proceso). Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-clientes.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

process.env.STRICT_OUTPUT = 'true';

const { validarEntidad } = await import('../../src/serverUtils/clientes/entidad');
const { fasesQueAplican, faltanParaCobrar, faltanParaFacturar, leerFasesGuardadas } = await import('../../src/lib/clientes/fases');
const { normalizarRfc, rfcValido, separarCorreos, normalizarUrl } = await import('../../src/lib/clientes/validacion');
const ep = {
  catalogo: (await import('../../src/api/getClientsCatalog')).default,
  detalle: (await import('../../src/api/getClientDetail')).default,
  crear: (await import('../../src/api/createClient')).default,
  entidad: (await import('../../src/api/saveClientEntity')).default,
  contacto: (await import('../../src/api/saveClientContact')).default,
  borrarContacto: (await import('../../src/api/deleteClientContact')).default,
  terminos: (await import('../../src/api/getClientCollectionTerms')).default,
  iniciar: (await import('../../src/api/startCollectionProcess')).default,
  activa: (await import('../../src/api/setClientEntityActive')).default,
  guardar: (await import('../../src/api/saveCollectionProcess')).default,
  proceso: (await import('../../src/api/getCollectionProcessDetail')).default,
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
const rechaza = (fn: () => Promise<unknown>, texto: string) => assert.rejects(fn, (e: Error) => { assert.ok(e.message.includes(texto), `esperaba «${texto}» y salió «${e.message}»`); return true; });

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
// Las dos tablas de Cobranza que no salen de schema.sql (server/scripts/add-cobranza-tables.ts).
await pg.exec(`
  create table collection_attachments (
    id uuid primary key default gen_random_uuid(),
    collection_process_id uuid not null references collection_processes(id) on delete cascade,
    doc_type text not null, name text, file_url text, description text,
    uploaded_by_email text, uploaded_by_name text, uploaded_at timestamptz, created_at timestamptz not null default now()
  );
  create table collection_audit_log (
    id uuid primary key default gen_random_uuid(),
    "timestamp" timestamptz not null default now(),
    collection_process_id uuid references collection_processes(id) on delete set null,
    action text not null, user_email text, user_name text, comments text, project_code text
  );
`);

const dueno = { user: { id: 'u-dueno', email: 'dueno@ejemplo.test', role: 'Owner', firstName: 'Dueño', lastName: 'Prueba' } } as any;
const finanzas = { user: { id: 'u-fin', email: 'fin@ejemplo.test', role: 'Analista', purchaseLevel: 'Finanzas', firstName: 'Fin', lastName: 'Prueba' } } as any;
const otro = { user: { id: 'u-otro', email: 'otro@ejemplo.test', role: 'Líder', purchaseLevel: 'Creador' } } as any;
const id = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params as any)).rows[0].id;
const una = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params as any)).rows[0];

// ── Puras: validación, limpieza y pasos ─────────────────────────────────────
const base = { legalName: 'Alfa Servicios SA de CV', rfc: 'ASE010101AB1', taxRegime: '601', postalCode: '06600', cfdiUse: 'G03', paymentMethod: 'PPD', paymentForm: '99', billingEmails: 'facturas@ejemplo.test', creditDays: 45 };

await prueba('validar: una razón social buena no trae errores y sale limpia', () => {
  const { errores, record } = validarEntidad(base);
  assert.deepEqual(errores, []);
  assert.equal(record.legalName, 'Alfa Servicios SA de CV');
  assert.equal(record.rfc, 'ASE010101AB1');
  assert.equal(record.creditDays, 45);
  assert.equal(record.requiresPortal, false);
});
await prueba('validar: el RFC se limpia (minúsculas, espacios y guiones) y se revisa el formato', () => {
  assert.equal(normalizarRfc(' ase-010101 ab1 '), 'ASE010101AB1');
  assert.ok(rfcValido('ASE010101AB1'));
  assert.ok(rfcValido('XAXX010101000'), 'el RFC genérico es válido');
  assert.ok(rfcValido('PEPJ800101AB1'), 'persona física: 13 caracteres');
  assert.ok(!rfcValido('ASE01010AB1'));
  assert.ok(validarEntidad({ ...base, rfc: 'ASE0101' }).errores.some(e => e.includes('RFC')));
});
await prueba('validar: razón social obligatoria, código postal de 5 dígitos y días de crédito enteros entre 0 y 365', () => {
  assert.ok(validarEntidad({ ...base, legalName: '   ' }).errores.some(e => e.includes('razón social')));
  assert.ok(validarEntidad({ ...base, postalCode: '6600' }).errores.some(e => e.includes('código postal')));
  assert.ok(validarEntidad({ ...base, creditDays: -1 }).errores.some(e => e.includes('días de crédito')));
  assert.ok(validarEntidad({ ...base, creditDays: 400 }).errores.some(e => e.includes('días de crédito')));
  assert.ok(validarEntidad({ ...base, creditDays: 30.5 }).errores.some(e => e.includes('días de crédito')));
  assert.equal(validarEntidad({ ...base, creditDays: null }).record.creditDays, null);
  assert.equal(validarEntidad({ ...base, creditDays: 0 }).record.creditDays, 0, 'cero días (de contado) es un valor, no «sin dato»');
});
await prueba('validar: régimen, uso del CFDI, método y forma de pago tienen que estar en los catálogos', () => {
  assert.ok(validarEntidad({ ...base, taxRegime: '999' }).errores.some(e => e.includes('régimen')));
  assert.ok(validarEntidad({ ...base, cfdiUse: 'X99' }).errores.some(e => e.includes('uso del CFDI')));
  assert.ok(validarEntidad({ ...base, paymentMethod: 'XYZ' }).errores.some(e => e.includes('PUE o PPD')));
  assert.ok(validarEntidad({ ...base, paymentForm: '77' }).errores.some(e => e.includes('forma de pago')));
});
await prueba('validar: correos separados por coma, punto y coma o espacio, sin repetidos, y se avisa cuál está mal', () => {
  assert.deepEqual(separarCorreos('a@ejemplo.test; b@ejemplo.test, A@ejemplo.test  c@ejemplo.test'), ['a@ejemplo.test', 'b@ejemplo.test', 'c@ejemplo.test']);
  assert.equal(validarEntidad({ ...base, billingEmails: 'a@ejemplo.test; b@ejemplo.test' }).record.billingEmails, 'a@ejemplo.test, b@ejemplo.test');
  const mal = validarEntidad({ ...base, billingEmails: 'a@ejemplo.test, sin-arroba' });
  assert.ok(mal.errores.some(e => e.includes('sin-arroba')));
});
await prueba('validar: la liga del portal se completa con https:// y se rechaza si no es una dirección', () => {
  assert.equal(normalizarUrl('portal.ejemplo.test/proveedores'), 'https://portal.ejemplo.test/proveedores');
  assert.equal(normalizarUrl('intranet'), undefined);
  assert.ok(validarEntidad({ ...base, portalUrl: 'intranet' }).errores.some(e => e.includes('portal')));
  assert.equal(validarEntidad({ ...base, portalUrl: '' }).record.portalUrl, null);
});
await prueba('validar: lo que no viene se guarda como null (borrar un dato en la pantalla lo borra) y las banderas como false', () => {
  const { record } = validarEntidad({ legalName: 'Solo nombre' });
  for (const k of ['rfc', 'taxRegime', 'postalCode', 'cfdiUse', 'paymentMethod', 'paymentForm', 'billingEmails', 'creditDays', 'portalUrl', 'processNotes']) assert.equal(record[k], null, k);
  for (const k of ['requiresPo', 'requiresPortal', 'requiresGr', 'requiresProforma']) assert.equal(record[k], false, k);
});
await prueba('pasos: sin banderas son factura creada → enviada → cobranza programada → pagada; portal, GR/Migo y proforma se acomodan en su lugar', () => {
  assert.deepEqual(fasesQueAplican({}), ['Por iniciar', 'Factura creada', 'Factura enviada', 'Cobranza programada', 'Pagada']);
  assert.deepEqual(fasesQueAplican({ requiresPortal: true, requiresGr: true }), ['Por iniciar', 'Factura creada', 'Factura enviada', 'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada']);
  assert.deepEqual(fasesQueAplican({ requiresProforma: true }), ['Por iniciar', 'Proforma creada', 'Proforma enviada', 'Factura creada', 'Factura enviada', 'Cobranza programada', 'Pagada']);
});
await prueba('pasos guardados: se leen del JSON del proceso; vacío o ilegible significa «todos»', () => {
  assert.deepEqual(leerFasesGuardadas('["Factura creada","Pagada"]'), ['Factura creada', 'Pagada']);
  assert.equal(leerFasesGuardadas(''), undefined);
  assert.equal(leerFasesGuardadas(null), undefined);
  assert.equal(leerFasesGuardadas('no es json'), undefined);
  assert.equal(leerFasesGuardadas('[]'), undefined);
  assert.equal(leerFasesGuardadas('[1,2]'), undefined);
});
await prueba('qué falta: para cobrar solo los días de crédito; para facturar razón social, RFC, régimen, código postal y uso del CFDI', () => {
  assert.deepEqual(faltanParaCobrar({ creditDays: 0 }), []);
  assert.deepEqual(faltanParaCobrar({}), ['días de crédito']);
  assert.deepEqual(faltanParaFacturar(base), []);
  assert.deepEqual(faltanParaFacturar({ legalName: 'X' }), ['RFC', 'régimen fiscal', 'código postal fiscal', 'uso del CFDI']);
});

// ── Con base de datos ───────────────────────────────────────────────────────
const clienteA = await id(`insert into clients (name) values ('Cliente Alfa') returning id`);
const clienteB = await id(`insert into clients (name) values ('Cliente Beta') returning id`);
await id(`insert into deals (deal_name, client, client_id) values ('Deal 1', 'Cliente Alfa', $1) returning id`, [clienteA]);
await id(`insert into deals (deal_name, client, client_id) values ('Deal 2', 'Cliente Alfa', $1) returning id`, [clienteA]);
await id(`insert into deals (deal_name, client, client_id) values ('Deal 3', 'Cliente Beta', $1) returning id`, [clienteB]);
const proyA = await id(`insert into projects (project_code, client, client_id, budget) values ('PRB-1', 'Cliente Alfa', $1, 100000) returning id`, [clienteA]);
await id(`insert into projects (project_code, client, client_id, budget) values ('PRB-2', '  cliente BETA ', null, 80000) returning id`);
await id(`insert into projects (project_code, client, client_id, budget) values ('PRB-3', 'Cliente Beta', $1, 60000) returning id`, [clienteB]);
void proyA;

const nueva = (clientId: string, extra: Record<string, unknown> = {}, ctx = dueno) => ep.entidad.run({ clientId, ...base, ...extra } as any, ctx) as Promise<{ success: boolean; id: string }>;
const ficha = async (clientId: string) => (await ep.detalle.run({ clientId }, dueno)) as any;

await prueba('candado: solo Owner o nivel Finanzas ven y editan el catálogo', async () => {
  await rechaza(() => ep.catalogo.run({}, otro), 'No tienes permisos');
  await rechaza(() => ep.detalle.run({ clientId: clienteA }, otro), 'No tienes permisos');
  await rechaza(() => ep.crear.run({ name: 'Nuevo' }, otro), 'No tienes permisos');
  await rechaza(() => ep.entidad.run({ clientId: clienteA, legalName: 'X' }, otro), 'No tienes permisos');
  await rechaza(() => ep.contacto.run({ clientId: clienteA, name: 'X' }, otro), 'No tienes permisos');
  await rechaza(() => ep.borrarContacto.run({ id: clienteA }, otro), 'No tienes permisos');
  await rechaza(() => ep.activa.run({ id: clienteA, active: false }, otro), 'No tienes permisos');
  await rechaza(() => ep.terminos.run({ clientId: clienteA }, otro), 'No tienes permisos');
  assert.equal(((await ep.catalogo.run({}, finanzas)) as any).clients.length, 2, 'Finanzas sí entra');
});
await prueba('crear cliente: guarda el nombre limpio, no deja repetidos (sin importar mayúsculas ni espacios) y rechaza nombres muy cortos', async () => {
  const r = (await ep.crear.run({ name: '  Cliente   Gamma ' }, dueno)) as any;
  assert.equal(r.name, 'Cliente Gamma');
  assert.equal((await una(`select name from clients where id = $1`, [r.id])).name, 'Cliente Gamma');
  await rechaza(() => ep.crear.run({ name: 'cliente gamma' }, dueno), 'Ya existe');
  await rechaza(() => ep.crear.run({ name: 'A' }, dueno), 'Escribe el nombre');
  await pg.query(`delete from clients where id = $1`, [r.id]);
});
await prueba('razón social: se crea con los datos limpios y aparece en la ficha del cliente', async () => {
  const r = await nueva(clienteA, { rfc: ' ase-010101ab1 ', billingEmails: 'Facturas@ejemplo.test; pagos@ejemplo.test', requiresPortal: true, portalUrl: 'portal.ejemplo.test', processNotes: '  Subir PDF y XML al portal.  ' });
  const f = await ficha(clienteA);
  assert.equal(f.entities.length, 1);
  const e = f.entities[0];
  assert.equal(e.id, r.id);
  assert.equal(e.clientId, clienteA);
  assert.equal(e.rfc, 'ASE010101AB1');
  assert.equal(e.billingEmails, 'Facturas@ejemplo.test, pagos@ejemplo.test');
  assert.equal(e.portalUrl, 'https://portal.ejemplo.test/');
  assert.equal(e.processNotes, 'Subir PDF y XML al portal.');
  assert.equal(e.requiresPortal, true);
  assert.equal(e.requiresGr, false);
  assert.equal(e.active, true);
  assert.equal(e.creditDays, 45);
});
await prueba('razón social: el mismo RFC no se repite dentro del cliente, pero sí puede estar en otro cliente', async () => {
  await rechaza(() => nueva(clienteA, { legalName: 'Otra razón social' }), 'Ese RFC ya está registrado');
  await rechaza(() => nueva(clienteA, { legalName: 'Otra razón social', rfc: 'ase010101ab1' }), 'Ese RFC ya está registrado');
  const enOtro = await nueva(clienteB, { legalName: 'Beta Comercial SA de CV' });
  assert.ok(enOtro.id);
});
await prueba('razón social: los datos inválidos se rechazan con un mensaje en español', async () => {
  await rechaza(() => nueva(clienteB, { legalName: 'Mala', rfc: 'MALO' }), 'RFC');
  await rechaza(() => nueva(clienteB, { legalName: 'Mala', rfc: 'MAL010101AB2', postalCode: '123' }), 'código postal');
  await rechaza(() => nueva(clienteB, { legalName: '', rfc: 'MAL010101AB3' }), 'razón social');
  await rechaza(() => ep.entidad.run({ clientId: '00000000-0000-0000-0000-000000000000', legalName: 'X' }, dueno), 'Cliente no encontrado');
});
await prueba('razón social: editar reemplaza los campos (borrar un dato lo borra) y no cambia de cliente', async () => {
  const r = await nueva(clienteB, { legalName: 'Beta Operadora SA de CV', rfc: 'BOP010101AB4', creditDays: 60, processNotes: 'Nota vieja', requiresGr: true });
  await ep.entidad.run({ id: r.id, clientId: clienteB, legalName: 'Beta Operadora SA de CV', rfc: 'BOP010101AB4', creditDays: 30 } as any, dueno);
  const e = (await ficha(clienteB)).entities.find((x: any) => x.id === r.id);
  assert.equal(e.creditDays, 30);
  assert.equal(e.processNotes, undefined, 'la nota se borró');
  assert.equal(e.requiresGr, false, 'la bandera se apagó');
  assert.equal(e.taxRegime, undefined);
  await rechaza(() => ep.entidad.run({ id: r.id, clientId: clienteA, legalName: 'X' } as any, dueno), 'otro cliente');
  await rechaza(() => ep.entidad.run({ id: '00000000-0000-0000-0000-000000000000', clientId: clienteB, legalName: 'X' } as any, dueno), 'Razón social no encontrada');
  await rechaza(() => ep.activa.run({ id: '00000000-0000-0000-0000-000000000000', active: false }, dueno), 'Razón social no encontrada');
});
await prueba('razón social: desactivar la saca de las listas de cobro pero no la borra, y guardarla otra vez no la reactiva', async () => {
  const r = await nueva(clienteB, { legalName: 'Beta Vieja SA de CV', rfc: 'BVI010101AB5' });
  await ep.activa.run({ id: r.id, active: false }, dueno);
  assert.equal((await ficha(clienteB)).entities.find((x: any) => x.id === r.id).active, false);
  assert.ok(!((await ep.terminos.run({ clientId: clienteB }, dueno)) as any).entities.some((x: any) => x.id === r.id), 'ya no sale al arrancar un proceso');
  await ep.entidad.run({ id: r.id, clientId: clienteB, legalName: 'Beta Vieja SA de CV', rfc: 'BVI010101AB5', creditDays: 15 } as any, dueno);
  assert.equal((await ficha(clienteB)).entities.find((x: any) => x.id === r.id).active, false, 'guardar datos no reactiva');
  await ep.activa.run({ id: r.id, active: true }, dueno);
  assert.equal((await ficha(clienteB)).entities.find((x: any) => x.id === r.id).active, true);
  assert.ok(((await ep.terminos.run({ clientId: clienteB }, dueno)) as any).entities.some((x: any) => x.id === r.id));
});
await prueba('contactos: se ligan al cliente y, si se quiere, a una razón social del mismo cliente; correo y rol se validan', async () => {
  const entA = (await ficha(clienteA)).entities[0].id;
  const entB = (await ficha(clienteB)).entities[0].id;
  const c = (await ep.contacto.run({ clientId: clienteA, entityId: entA, name: ' Ana Prueba ', email: 'ana@ejemplo.test', phone: '55 0000 0000', role: 'Recibe facturas' }, dueno)) as any;
  const f = await ficha(clienteA);
  assert.equal(f.contacts.length, 1);
  assert.equal(f.contacts[0].name, 'Ana Prueba');
  assert.equal(f.contacts[0].entityId, entA);
  assert.equal(f.contacts[0].role, 'Recibe facturas');
  await rechaza(() => ep.contacto.run({ clientId: clienteA, entityId: entB, name: 'Luis Prueba' }, dueno), 'otro cliente');
  await rechaza(() => ep.contacto.run({ clientId: clienteA, name: '' }, dueno), 'nombre del contacto');
  await rechaza(() => ep.contacto.run({ clientId: clienteA, name: 'Luis', email: 'sin-arroba' }, dueno), 'correo');
  await rechaza(() => ep.contacto.run({ clientId: clienteA, name: 'Luis', role: 'Jefe' }, dueno), 'rol');
  await ep.contacto.run({ id: c.id, clientId: clienteA, entityId: null, name: 'Ana Prueba', email: '', role: 'Libera pagos' }, dueno);
  const g = (await ficha(clienteA)).contacts[0];
  assert.equal(g.entityId, undefined, 'se pudo quitar la razón social');
  assert.equal(g.email, undefined, 'el correo se borró');
  assert.equal(g.role, 'Libera pagos');
  await ep.borrarContacto.run({ id: c.id }, dueno);
  assert.equal((await ficha(clienteA)).contacts.length, 0);
});
await prueba('catálogo: cuenta razones sociales activas, cuántas están listas para cobrar y para facturar, contactos, deals y proyectos', async () => {
  const sinDatos = await nueva(clienteB, { legalName: 'Beta Incompleta', rfc: 'BIN010101AB6', creditDays: null, taxRegime: '', postalCode: '', cfdiUse: '' });
  await ep.activa.run({ id: sinDatos.id, active: false }, dueno);
  const lista = ((await ep.catalogo.run({}, dueno)) as any).clients;
  const a = lista.find((c: any) => c.id === clienteA);
  const b = lista.find((c: any) => c.id === clienteB);
  assert.deepEqual([a.entities, a.cobroListo, a.facturaListo, a.deals, a.projects], [1, 1, 1, 2, 1]);
  assert.equal(b.entities, 3, 'las desactivadas no cuentan');
  assert.equal(b.deals, 1);
  assert.equal(b.projects, 1, 'solo los proyectos con client_id');
  assert.deepEqual(lista.map((c: any) => c.name), ['Cliente Alfa', 'Cliente Beta'], 'ordenados por nombre');
  await ep.contacto.run({ clientId: clienteA, name: 'Ana Prueba' }, dueno);
  assert.equal(((await ep.catalogo.run({}, dueno)) as any).clients.find((c: any) => c.id === clienteA).contacts, 1);
});
await prueba('términos de cobro: se encuentra el cliente por id, por el client_id del proyecto, por el nombre del proyecto y por nombre; solo razones sociales activas', async () => {
  const porId = (await ep.terminos.run({ clientId: clienteA }, dueno)) as any;
  assert.equal(porId.found, true);
  assert.equal(porId.clientName, 'Cliente Alfa');
  assert.equal(porId.entities.length, 1);
  const porProyecto = (await ep.terminos.run({ projectCode: 'PRB-1' }, dueno)) as any;
  assert.equal(porProyecto.clientId, clienteA);
  const porNombreDelProyecto = (await ep.terminos.run({ projectCode: 'PRB-2' }, dueno)) as any;
  assert.equal(porNombreDelProyecto.clientId, clienteB, 'PRB-2 no tiene client_id: se busca por su texto, sin importar mayúsculas ni espacios');
  const porNombre = (await ep.terminos.run({ client: ' CLIENTE alfa' }, dueno)) as any;
  assert.equal(porNombre.clientId, clienteA);
  assert.equal(porId.entities.every((e: any) => e.active), true);
  assert.equal(((await ep.terminos.run({ client: 'Nadie' }, dueno)) as any).found, false);
  assert.equal(((await ep.terminos.run({}, dueno)) as any).found, false);
});

// ── Cobranza usa el catálogo ────────────────────────────────────────────────
const entA = (await ficha(clienteA)).entities[0].id as string;
const entPortal = await nueva(clienteA, { legalName: 'Alfa Portal SA de CV', rfc: 'APO010101AB7', creditDays: 60, requiresPortal: true, requiresGr: true });
const ctxProceso = dueno;
const proceso = async (id: string) => una(`select client_id, client_entity_id, credit_days, applicable_phases, scheduled_payment_date::text as fecha, phase, invoice_number from collection_processes where id = $1`, [id]);

await prueba('iniciar un proceso con razón social: ya no falla (antes tronaba al guardar los días de crédito en clients) y guarda cliente, razón social y los pasos que aplican', async () => {
  const r = (await ep.iniciar.run({ projectCode: 'PRB-1', invoiceNumber: 'F-1001', invoiceDate: '2026-11-02', creditDays: 60, clientEntityId: entPortal.id }, ctxProceso)) as any;
  assert.equal(r.success, true);
  const p = await proceso(r.collectionProcessId);
  assert.equal(p.client_id, clienteA);
  assert.equal(p.client_entity_id, entPortal.id);
  assert.equal(p.credit_days, 60);
  assert.equal(p.fecha, '2027-01-01');
  assert.deepEqual(JSON.parse(p.applicable_phases), ['Por iniciar', 'Factura creada', 'Factura enviada', 'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada']);
  const bitacora = await una(`select action, comments from collection_audit_log where collection_process_id = $1`, [r.collectionProcessId]);
  assert.equal(bitacora.action, 'Creado');
  assert.ok(bitacora.comments.includes('F-1001') && bitacora.comments.includes('Alfa Portal SA de CV'));
  assert.equal((await una(`select count(*)::int as n from clients`)).n >= 2, true, 'el catálogo de clientes no se tocó');
  await rechaza(() => ep.iniciar.run({ projectCode: 'PRB-1', invoiceNumber: 'F-1002', invoiceDate: '2026-11-02', creditDays: 30 }, ctxProceso), 'ya tiene un proceso');
});
await prueba('iniciar un proceso: la razón social tiene que ser del cliente del proyecto y estar activa', async () => {
  const deB = (await ficha(clienteB)).entities.find((e: any) => e.active).id as string;
  await rechaza(() => ep.iniciar.run({ projectCode: 'PRB-3', invoiceNumber: 'F-2001', invoiceDate: '2026-11-02', creditDays: 30, clientEntityId: entPortal.id }, ctxProceso), 'no es de este cliente');
  const inactiva = (await ficha(clienteB)).entities.find((e: any) => !e.active).id as string;
  await rechaza(() => ep.iniciar.run({ projectCode: 'PRB-3', invoiceNumber: 'F-2001', invoiceDate: '2026-11-02', creditDays: 30, clientEntityId: inactiva }, ctxProceso), 'ya no está disponible');
  await rechaza(() => ep.iniciar.run({ projectCode: 'PRB-3', invoiceNumber: 'F-2001', invoiceDate: '2026-11-02', creditDays: 30, clientEntityId: '00000000-0000-0000-0000-000000000000' }, ctxProceso), 'ya no está disponible');
  const ok = (await ep.iniciar.run({ projectCode: 'PRB-3', invoiceNumber: 'F-2001', invoiceDate: '2026-11-02', creditDays: 30, clientEntityId: deB }, ctxProceso)) as any;
  assert.equal((await proceso(ok.collectionProcessId)).client_entity_id, deB);
});
await prueba('iniciar un proceso sin razón social sigue funcionando: toma el cliente del proyecto por nombre y muestra todos los pasos', async () => {
  const r = (await ep.iniciar.run({ projectCode: 'PRB-2', invoiceNumber: 'F-3001', invoiceDate: '2026-11-02', creditDays: 30 }, ctxProceso)) as any;
  const p = await proceso(r.collectionProcessId);
  assert.equal(p.client_id, clienteB, 'PRB-2 no tenía client_id: se resolvió por su nombre');
  assert.equal(p.client_entity_id, null);
  assert.equal(p.applicable_phases, null);
  assert.equal(p.fecha, '2026-12-02');
});
await prueba('iniciar un proceso: solo Owner o Finanzas', async () => {
  await rechaza(() => ep.iniciar.run({ projectCode: 'PRB-1', invoiceNumber: 'F-9', invoiceDate: '2026-11-02', creditDays: 30 }, otro), 'No tienes permisos');
});

// Un proceso heredado de Zite: sin días de crédito, con fecha de factura.
const heredado = async (codigo: string, creditDays: number | null, clientId: string | null = clienteA) =>
  id(`insert into collection_processes (project_code, client, client_id, phase, status, currency, collection_amount, invoice_created_at, credit_days)
      values ($1, 'Cliente Alfa', $2, 'Por iniciar', 'Al día', 'MXN', 50000, '2026-10-01', $3) returning id`, [codigo, clientId, creditDays]);

await prueba('asignar la razón social a un proceso heredado: toma sus días de crédito, calcula la fecha de pago y deja bitácora', async () => {
  const pid = await heredado('PRB-H1', null);
  await ep.guardar.run({ id: pid, clientEntityId: entA }, dueno);
  const p = await proceso(pid);
  assert.equal(p.client_entity_id, entA);
  assert.equal(p.credit_days, 45);
  assert.equal(p.fecha, '2026-11-15');
  assert.deepEqual(JSON.parse(p.applicable_phases), ['Por iniciar', 'Factura creada', 'Factura enviada', 'Subida al portal', 'Cobranza programada', 'Pagada'], 'esa razón social pide portal pero no GR/Migo');
  const b = await una(`select action, comments from collection_audit_log where collection_process_id = $1`, [pid]);
  assert.equal(b.action, 'Editado');
  assert.equal(b.comments, 'Razón social: Alfa Servicios SA de CV');
});
await prueba('asignar la razón social no pisa los días de crédito que el proceso ya tiene ni los que vienen en el mismo guardado', async () => {
  const conDias = await heredado('PRB-H2', 90);
  await ep.guardar.run({ id: conDias, clientEntityId: entA }, dueno);
  assert.equal((await proceso(conDias)).credit_days, 90);
  const manda = await heredado('PRB-H3', null);
  await ep.guardar.run({ id: manda, clientEntityId: entA, creditDays: 20 }, dueno);
  assert.equal((await proceso(manda)).credit_days, 20);
});
await prueba('asignar la razón social: tiene que ser del cliente del proceso; volver a asignar la misma no deja otra bitácora', async () => {
  const pid = await heredado('PRB-H4', null);
  const deB = (await ficha(clienteB)).entities.find((e: any) => e.active).id as string;
  await rechaza(() => ep.guardar.run({ id: pid, clientEntityId: deB }, dueno), 'no es de este cliente');
  await rechaza(() => ep.guardar.run({ id: pid, clientEntityId: '00000000-0000-0000-0000-000000000000' }, dueno), 'Razón social no encontrada');
  await ep.guardar.run({ id: pid, clientEntityId: entA }, dueno);
  await ep.guardar.run({ id: pid, clientEntityId: entA }, dueno);
  assert.equal((await una(`select count(*)::int as n from collection_audit_log where collection_process_id = $1 and comments like 'Razón social%'`, [pid])).n, 1);
});
await prueba('asignar la razón social a un proceso sin client_id lo liga también al cliente', async () => {
  const pid = await heredado('PRB-H5', null, null);
  await ep.guardar.run({ id: pid, clientEntityId: entA }, dueno);
  const p = await proceso(pid);
  assert.equal(p.client_id, clienteA);
});
await prueba('detalle del proceso: trae la razón social asignada, sus pasos y el catálogo del cliente (con la asignada aunque ya esté desactivada)', async () => {
  const pid = await heredado('PRB-H6', null);
  await ep.guardar.run({ id: pid, clientEntityId: entPortal.id }, dueno);
  await ep.activa.run({ id: entPortal.id, active: false }, dueno);
  const d = (await ep.proceso.run({ id: pid }, dueno)) as any;
  assert.equal(d.clientEntityId, entPortal.id);
  assert.deepEqual(d.applicablePhases, ['Por iniciar', 'Factura creada', 'Factura enviada', 'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada']);
  assert.equal(d.clientCatalog.clientId, clienteA);
  assert.equal(d.clientCatalog.clientName, 'Cliente Alfa');
  assert.ok(d.clientCatalog.entities.some((e: any) => e.id === entPortal.id && e.active === false), 'la asignada sigue a la vista aunque esté desactivada');
  assert.ok(d.clientCatalog.entities.some((e: any) => e.id === entA));
  assert.ok(Array.isArray(d.clientCatalog.contacts));
  const sinCatalogo = await id(`insert into collection_processes (project_code, client, phase, status) values ('PRB-H7', 'Cliente que no existe', 'Por iniciar', 'Al día') returning id`);
  const s = (await ep.proceso.run({ id: sinCatalogo }, dueno)) as any;
  assert.equal(s.clientCatalog, undefined);
  assert.equal(s.applicablePhases, undefined);
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
