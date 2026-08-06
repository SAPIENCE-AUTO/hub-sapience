import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { createModel } from './compat/model';
import { buildWhere } from './compat/filters';
import { SCHEMA } from './compat/schema-map';
import { DATE_OID, TIMESTAMPTZ_OID, parseDate, parseTimestamptz } from './compat/datetimeParsers';

// Mismos parsers que db.ts (ver datetimeParsers.ts), aplicados al mecanismo de
// PGlite en vez de pg.types.setTypeParser: si esto falta, PGlite devuelve `Date`
// de JS igual que `pg` sin el fix, y las pruebas de abajo lo detectan.
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz } });
const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .replace(/create extension if not exists pg_trgm;.*/g, '')
  .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, '');
await pg.exec(sql);
// El cliente de la transacción debe reenviar los parámetros igual que el pool.
// Antes los descartaba, y eso ocultaba si create() usaba de verdad el cliente.
const pool: any = {
  query: (sql: string, params?: unknown[]) => pg.query(sql, params as any),
  connect: async () => ({
    query: (sql: string, params?: unknown[]) => pg.query(sql, params as any),
    release: () => {},
  }),
};

const Users = createModel(pool, 'Users');
const Projects = createModel(pool, 'Projects');
const Deals = createModel(pool, 'Deals');
const Cotizaciones = createModel(pool, 'Cotizaciones');
const CotizacionLineItems = createModel(pool, 'CotizacionLineItems');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('\n── create + campos escalares y arreglos ──');
const ana = await Users.create({ record: { email: 'ana@sapience.mx', firstName: 'Ana', lastName: 'R', role: 'Analista', costCenters: ['Logística', 'Management'], maxApprovalAmount: 15000.50 } });
check('create devuelve el registro con id', !!ana.id);
check('multiple_select se guarda como array', Array.isArray(ana.costCenters) && ana.costCenters.length === 2, JSON.stringify(ana.costCenters));
check('currency conserva centavos', Number(ana.maxApprovalAmount) === 15000.5, String(ana.maxApprovalAmount));

const luis = await Users.create({ record: { email: 'luis@sapience.mx', firstName: 'Luis', role: 'Moderador' as any } }).catch((e: Error) => e);
check('CHECK rechaza opción inválida de single_select', luis instanceof Error);
const luisOk = await Users.create({ record: { email: 'luis@sapience.mx', firstName: 'Luis', role: 'Coordinador' } });

console.log('\n── linked_record N-1 se lee como arreglo de IDs (fidelidad con Zite) ──');
const deal = await Deals.create({ record: { dealName: 'Estudio Pacífico', client: 'Grupo Modelo', phase: 'Cotización enviada', owner: [ana.id], clientPrice: 250000 } });
check('link se expone como string[]', Array.isArray(deal.owner) && deal.owner[0] === ana.id, JSON.stringify(deal.owner));
const dealPlano = await Deals.create({ record: { dealName: 'Otro', owner: luisOk.id } });
check('link acepta string suelto al escribir', dealPlano.owner[0] === luisOk.id);
const sinOwner = await Deals.create({ record: { dealName: 'Sin dueño' } });
check('link vacío devuelve [] y no null', Array.isArray(sinOwner.owner) && sinOwner.owner.length === 0, JSON.stringify(sinOwner.owner));

console.log('\n── filtro `contains` sobre link (patrón real del código) ──');
const cot = await Cotizaciones.create({ record: { deal: [deal.id], totalCost: 180000, clientPrice: 250000 } });
await CotizacionLineItems.create({ record: { cotizacion: [cot.id], rubro: 'Moderación', cantidad: 4, unitCost: 5000 } });
await CotizacionLineItems.create({ record: { cotizacion: [cot.id], rubro: 'Logística y operación', cantidad: 2, unitCost: 3000 } });
const porContains = await CotizacionLineItems.findAll({ filters: { cotizacion: { contains: cot.id } } });
check('filters.cotizacion.contains encuentra las partidas', porContains.records.length === 2, String(porContains.records.length));
const porIgualdad = await CotizacionLineItems.findAll({ filters: { cotizacion: cot.id } });
check('filters.cotizacion plano funciona igual', porIgualdad.records.length === 2, String(porIgualdad.records.length));

console.log('\n── relación N-N vía tabla puente ──');
const proj = await Projects.create({ record: { projectCode: 'PJT-100', fullName: 'Pacífico Day', status: 'En curso', lider: [ana.id], analistas: [ana.id, luisOk.id] } });
check('analistas se guarda en la tabla puente', proj.analistas?.length === 2, JSON.stringify(proj.analistas));
const porAnalista = await Projects.findAll({ filters: { analistas: { contains: luisOk.id } } });
check('se puede filtrar por miembro del equipo', porAnalista.records.length === 1, String(porAnalista.records.length));
const upd = await Projects.update({ id: proj.id, record: { analistas: [ana.id] } });
check('update reemplaza el conjunto N-N', upd?.analistas?.length === 1, JSON.stringify(upd?.analistas));

console.log('\n── findOne en sus dos formas ──');
check('findOne({ id })', (await Projects.findOne({ id: proj.id }))?.projectCode === 'PJT-100');
check('findOne({ filters })', (await Projects.findOne({ filters: { projectCode: 'PJT-100' } }))?.id === proj.id);
check('findOne inexistente devuelve null', (await Projects.findOne({ id: '00000000-0000-0000-0000-000000000000' })) === null);

console.log('\n── operadores restantes ──');
check('in', (await Users.findAll({ filters: { role: { in: ['Analista', 'Coordinador'] } } })).records.length === 2);
check('in con lista vacía devuelve 0, no todo', (await Users.findAll({ filters: { role: { in: [] } } })).records.length === 0);
check('contains sobre texto es ILIKE', (await Deals.findAll({ filters: { dealName: { contains: 'pacífico' } } })).records.length === 1);
check('gt sobre currency', (await Deals.findAll({ filters: { clientPrice: { gt: 100000 } } })).records.length === 1);
check('not', (await Users.findAll({ filters: { role: { not: 'Analista' } } })).records.length === 1);

console.log('\n── fields, limit, offset ──');
const soloNombre = await Users.findAll({ fields: ['firstName'] });
check('fields limita las columnas', 'firstName' in soloNombre.records[0] && !('email' in soloNombre.records[0]), Object.keys(soloNombre.records[0]).join(','));
check('fields siempre incluye id', 'id' in soloNombre.records[0]);
check('limit', (await Users.findAll({ limit: 1 })).records.length === 1);
check('offset', (await Users.findAll({ offset: 1 })).records.length === 1);

console.log('\n── bulkCreate, delete, count ──');
const bulk = await CotizacionLineItems.bulkCreate({ records: [{ cotizacion: [cot.id], rubro: 'Management' }, { cotizacion: [cot.id], rubro: 'Back office' }] });
check('bulkCreate inserta el lote', bulk.records.length === 2);
check('count con filtro', (await CotizacionLineItems.count({ filters: { cotizacion: { contains: cot.id } } })) === 4);
await CotizacionLineItems.delete({ id: bulk.records[0].id });
check('delete', (await CotizacionLineItems.count({})) === 3);

console.log('\n── date/datetime salen como string, no Date de JS (regresión del bug de setTypeParser) ──');
const conFechas = await Projects.create({ record: { projectCode: 'PJT-FECHAS', startDate: '2024-01-15' } });
check('date sale como string', typeof conFechas.startDate === 'string', `typeof=${typeof conFechas.startDate} valor=${JSON.stringify(conFechas.startDate)}`);
check('date con formato "YYYY-MM-DD"', /^\d{4}-\d{2}-\d{2}$/.test(conFechas.startDate as any), String(conFechas.startDate));
check('datetime (updatedAt) sale como string', typeof conFechas.updatedAt === 'string', `typeof=${typeof conFechas.updatedAt} valor=${JSON.stringify(conFechas.updatedAt)}`);
check('datetime con formato ISO 8601 y Z', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(conFechas.updatedAt as any), String(conFechas.updatedAt));
const releida = await Projects.findOne({ id: conFechas.id });
check('sigue siendo string al releer con findOne (no solo en el create)', typeof releida?.startDate === 'string', `typeof=${typeof releida?.startDate}`);

console.log('\n── protecciones nuevas que Zite no tenía ──');
const err = await Users.findAll({ filters: { campoQueNoExiste: 1 } }).catch((e: Error) => e);
check('filtro sobre campo inexistente truena en vez de devolver todo', err instanceof Error, '');
const many = await Users.findAll({});
check('findAll sin filtro aplica límite por defecto', many.records.length <= 1000);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pruebas pasaron, ${fail} fallaron\n`);
process.exit(fail === 0 ? 0 : 1);
