import { pool as poolReal, ZiteError } from '../../../server/compat';
import { COLOR_SIN_ELEGIR, NOMBRE_MAX, NOMBRE_MIN, colorSiguiente, esColorValido } from '../../lib/pilares/catalogo';
import { MONTO_MAXIMO, formatoMonto, monedaCorta } from '../../lib/pilares/dinero';
import { TOLERANCIA, estadoReparto, hayPrecio, redondear, resumenTexto, sumar, type FilaReparto, type ResumenReparto } from '../../lib/pilares/reparto';
import { normalizar, sugerirDesdeTexto, type Sugerencia } from '../../lib/pilares/sugerencias';

// Todo lo que toca la base en Pilares. Los endpoints (src/api/*Pilar*.ts) solo validan la forma de lo que llega, exigen el acceso y llaman aquí.
// Reglas de fondo (ver también src/lib/pilares/reparto.ts): los montos se guardan en la moneda del deal; los porcentajes nunca se guardan; con UN solo pilar el ingreso queda
// vacío (vale el precio del deal); el costo es opcional; y cada vez que cambia el reparto de un deal, su «Tipo de proyecto» de texto se reescribe con los nombres de sus pilares
// («Cualitativo + Digital») para que el dashboard anterior, el tablero y los Excel que leen ese texto se limpien solos.

type Resultado = { rows: any[]; rowCount?: number | null };
type Cliente = { query: (sql: string, params?: unknown[]) => Promise<Resultado>; release: () => void };
interface Bd { query: (sql: string, params?: unknown[]) => Promise<Resultado>; connect: () => Promise<Cliente> }
let pool: Bd = poolReal as unknown as Bd;
/** Solo para pruebas: apunta el servicio a otra base (PGlite, ver server/scripts/test-pilares.ts). */
export function usarBaseParaPruebas(bd: Bd) { pool = bd; }

const malaPeticion = (message: string) => new ZiteError({ code: 'BAD_REQUEST', message });

export interface PilarCatalogo { id: string; nombre: string; color: string; orden: number; activo: boolean }
export interface ItemReparto { pilarId: string; precio: number | null; costo: number | null }
export interface DealBasico { id: string; nombre: string; cliente: string | null; fase: string | null; precio: number | null; moneda: string; tipoCambio: number | null; tipoProyecto: string | null; fecha: string | null }

const aPilar = (r: any): PilarCatalogo => ({ id: r.id, nombre: r.name, color: r.color ?? COLOR_SIN_ELEGIR, orden: Number(r.sort_order ?? 0), activo: !r.deactivated_at });

// ── Catálogo ────────────────────────────────────────────────────────────────

export async function listarPilares(): Promise<PilarCatalogo[]> {
  const { rows } = await pool.query(`select id, name, color, sort_order, deactivated_at from pilares order by sort_order, lower(name)`);
  return rows.map(aPilar);
}

/** El nombre limpio (espacios juntos y de los lados) o un error en claro. */
export function limpiarNombre(nombre: unknown): string {
  const n = typeof nombre === 'string' ? nombre.replace(/\s+/g, ' ').trim() : '';
  if (n.length < NOMBRE_MIN || n.length > NOMBRE_MAX) throw malaPeticion(`El nombre del pilar debe tener entre ${NOMBRE_MIN} y ${NOMBRE_MAX} letras.`);
  return n;
}

function chocaConOtro(nombre: string, catalogo: PilarCatalogo[], ignorarId?: string): PilarCatalogo | undefined {
  const plano = normalizar(nombre);
  return catalogo.find(p => p.id !== ignorarId && normalizar(p.nombre) === plano);
}

export async function crearPilar(args: { nombre: string; color?: string | null }): Promise<PilarCatalogo> {
  const nombre = limpiarNombre(args.nombre);
  const catalogo = await listarPilares();
  const igual = chocaConOtro(nombre, catalogo);
  if (igual) throw malaPeticion(`Ya existe un pilar llamado «${igual.nombre}»${igual.activo ? '' : ' (está desactivado: actívalo en lugar de crearlo otra vez)'}.`);
  if (args.color !== undefined && args.color !== null && !esColorValido(args.color)) throw malaPeticion('El color debe venir como #RRGGBB.');
  const color = args.color ?? colorSiguiente(catalogo.map(p => p.color));
  const orden = catalogo.reduce((m, p) => Math.max(m, p.orden), 0) + 1;
  try {
    const { rows } = await pool.query(`insert into pilares (name, color, sort_order) values ($1, $2, $3) returning id, name, color, sort_order, deactivated_at`, [nombre, color, orden]);
    return aPilar(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw malaPeticion('Ya existe un pilar con ese nombre.');
    throw e;
  }
}

export async function actualizarPilar(args: { id: string; nombre?: string; color?: string; activo?: boolean }): Promise<PilarCatalogo> {
  const catalogo = await listarPilares();
  const actual = catalogo.find(p => p.id === args.id);
  if (!actual) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pilar no encontrado' });
  const sets: string[] = [];
  const params: unknown[] = [];
  const poner = (col: string, valor: unknown) => { params.push(valor); sets.push(`${col} = $${params.length}`); };
  let renombrado = false;
  if (args.nombre !== undefined) {
    const nombre = limpiarNombre(args.nombre);
    const igual = chocaConOtro(nombre, catalogo, args.id);
    if (igual) throw malaPeticion(`Ya existe un pilar llamado «${igual.nombre}».`);
    if (nombre !== actual.nombre) { poner('name', nombre); renombrado = true; }
  }
  if (args.color !== undefined) {
    if (!esColorValido(args.color)) throw malaPeticion('El color debe venir como #RRGGBB.');
    poner('color', args.color);
  }
  if (args.activo !== undefined && args.activo !== actual.activo) sets.push(args.activo ? 'deactivated_at = null' : 'deactivated_at = now()');
  if (sets.length) {
    params.push(args.id);
    await pool.query(`update pilares set ${sets.join(', ')} where id = $${params.length}`, params);
  }
  if (renombrado) await reescribirTipoDeDealsDe(args.id);
  return (await listarPilares()).find(p => p.id === args.id)!;
}

/** Reescribe el «Tipo de proyecto» (texto) de todos los deals que tienen este pilar: se usa al renombrarlo. */
async function reescribirTipoDeDealsDe(pilarId: string) {
  await pool.query(
    `update deals d set project_type = x.texto
       from (select dp.deal_id, string_agg(p.name, ' + ' order by p.sort_order, lower(p.name)) as texto
               from deal_pilares dp join pilares p on p.id = dp.pilar_id
              where dp.deal_id in (select deal_id from deal_pilares where pilar_id = $1)
              group by dp.deal_id) x
      where d.id = x.deal_id`,
    [pilarId],
  );
}

// ── Un deal ─────────────────────────────────────────────────────────────────

const aDeal = (r: any): DealBasico => ({
  id: r.id,
  nombre: r.deal_name ?? '',
  cliente: r.client ?? null,
  fase: r.phase ?? null,
  precio: r.client_price === null || r.client_price === undefined ? null : Number(r.client_price),
  moneda: monedaCorta(r.currency),
  tipoCambio: r.exchange_rate === null || r.exchange_rate === undefined || Number(r.exchange_rate) === 0 ? null : Number(r.exchange_rate),
  tipoProyecto: r.project_type ?? null,
  fecha: r.fecha ?? null,
});

const COLUMNAS_DEAL = `d.id, d.deal_name, d.client, d.phase, d.client_price, d.currency, d.exchange_rate, d.project_type, coalesce(d.approval_date, d.proposal_date)::text as fecha`;

export async function leerDeal(dealId: string): Promise<DealBasico> {
  const { rows } = await pool.query(`select ${COLUMNAS_DEAL} from deals d where d.id = $1`, [dealId]);
  if (!rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Deal no encontrado' });
  return aDeal(rows[0]);
}

export async function leerItems(dealId: string): Promise<ItemReparto[]> {
  const { rows } = await pool.query(
    `select dp.pilar_id, dp.price, dp.cost from deal_pilares dp join pilares p on p.id = dp.pilar_id where dp.deal_id = $1 order by p.sort_order, lower(p.name)`,
    [dealId],
  );
  return rows.map(r => ({ pilarId: r.pilar_id, precio: r.price === null ? null : Number(r.price), costo: r.cost === null ? null : Number(r.cost) }));
}

const unNumero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Un monto que llega de afuera: vacío o un número de 0 a MONTO_MAXIMO, redondeado a centavos. */
function limpiarMonto(x: unknown, etiqueta: string): number | null {
  if (x === null || x === undefined) return null;
  if (!unNumero(x) || x < 0 || x > MONTO_MAXIMO) throw malaPeticion(`El ${etiqueta} de un pilar debe ser un monto de cero en adelante.`);
  return redondear(x);
}

export interface RespuestaReparto {
  deal: DealBasico;
  pilares: PilarCatalogo[];
  items: ItemReparto[];
  resumen: ResumenReparto;
  sugerencia: Sugerencia | null;
  /** Si quien consulta puede ver y capturar costos. */
  veCostos: boolean;
  referencias: { real: number | null; cotizado: number | null; otraMoneda: boolean } | null;
}

/** Costo registrado de un deal: lo gastado (órdenes de compra de sus proyectos, sin borradores ni canceladas) y lo cotizado (partidas de sus cotizaciones incluidas). Solo informativo. */
export async function referenciasDeCosto(dealId: string): Promise<{ real: number | null; cotizado: number | null; otraMoneda: boolean }> {
  const oc = await pool.query(
    `select count(*)::int as n, coalesce(sum(po.total_amount), 0) as total, coalesce(bool_or(upper(coalesce(po.currency, 'MXN')) not like 'MXN%'), false) as otra
       from purchase_orders po
      where po.project_code in (select project_code from projects where (deal_vinculado_id = $1 or deal_asignado_id = $1) and project_code is not null)
        and coalesce(po.status, '') not in ('Borrador', 'Cancelada')`,
    [dealId],
  );
  const cot = await pool.query(
    `select count(*)::int as n, coalesce(sum(coalesce(li.unit_cost, 0) * coalesce(li.cantidad, 1) * coalesce(li.componentes, 1)), 0) as total
       from cotizaciones c join cotizacion_line_items li on li.cotizacion_id = c.id
      where c.deal_id = $1 and c.included is not false`,
    [dealId],
  );
  return {
    real: oc.rows[0].n > 0 ? redondear(Number(oc.rows[0].total)) : null,
    cotizado: cot.rows[0].n > 0 ? redondear(Number(cot.rows[0].total)) : null,
    otraMoneda: !!oc.rows[0].otra,
  };
}

export async function leerRepartoDeal(dealId: string, veCostos: boolean): Promise<RespuestaReparto> {
  const [deal, pilares, items] = await Promise.all([leerDeal(dealId), listarPilares(), leerItems(dealId)]);
  const visibles = veCostos ? items : items.map(i => ({ ...i, costo: null }));
  const resumen = estadoReparto(items, deal.precio);
  const sugerencia = items.length === 0 ? sugerirDesdeTexto(deal.tipoProyecto, pilares.filter(p => p.activo)) : null;
  return { deal, pilares, items: visibles, resumen, sugerencia, veCostos, referencias: veCostos ? await referenciasDeCosto(dealId) : null };
}

/**
 * Guarda el reparto de un deal (reemplaza el anterior). Reglas: un pilar una vez; montos de cero en adelante; los pilares desactivados solo si el deal ya los traía; con varios pilares y
 * precio, el ingreso repartido no puede pasarse del precio; con un solo pilar el ingreso queda vacío; quien no puede ver costos no los toca (se conservan los que ya había).
 * Un reparto vacío lo borra (el texto de «Tipo de proyecto» se deja como estaba).
 */
export async function guardarRepartoDeal(args: { dealId: string; items: ItemReparto[]; veCostos: boolean }): Promise<RespuestaReparto> {
  const { dealId, veCostos } = args;
  if (args.items.length > 30) throw malaPeticion('Un deal no puede repartirse en tantos pilares.');
  const ids = args.items.map(i => i.pilarId);
  if (new Set(ids).size !== ids.length) throw malaPeticion('Un pilar solo puede aparecer una vez en el mismo deal.');

  const [deal, catalogo, previos] = await Promise.all([leerDeal(dealId), listarPilares(), leerItems(dealId)]);
  const dePilar = new Map(catalogo.map(p => [p.id, p]));
  const yaTraia = new Set(previos.map(i => i.pilarId));
  const costoPrevio = new Map(previos.map(i => [i.pilarId, i.costo]));

  let items: ItemReparto[] = args.items.map(i => {
    const p = dePilar.get(i.pilarId);
    if (!p) throw malaPeticion('Uno de los pilares ya no existe.');
    if (!p.activo && !yaTraia.has(p.id)) throw malaPeticion(`El pilar «${p.nombre}» está desactivado: actívalo antes de usarlo.`);
    return {
      pilarId: i.pilarId,
      precio: limpiarMonto(i.precio, 'ingreso'),
      costo: veCostos ? limpiarMonto(i.costo, 'costo') : (costoPrevio.get(i.pilarId) ?? null),
    };
  });
  if (items.length === 1) items = [{ ...items[0], precio: null }];

  if (items.length >= 2 && hayPrecio(deal.precio)) {
    const repartido = sumar(items as FilaReparto[], 'precio');
    if (repartido - deal.precio > TOLERANCIA) {
      throw malaPeticion(`El reparto suma ${formatoMonto(repartido, deal.moneda)} y el precio del deal es ${formatoMonto(deal.precio, deal.moneda)}: se pasa por ${formatoMonto(redondear(repartido - deal.precio), deal.moneda)}.`);
    }
  }

  const nombresEnOrden = catalogo.filter(p => ids.includes(p.id)).map(p => p.nombre); // el catálogo ya viene en su orden
  const cn = await pool.connect();
  try {
    await cn.query('begin');
    await cn.query(`delete from deal_pilares where deal_id = $1 and not (pilar_id = any($2::uuid[]))`, [dealId, ids]);
    for (const i of items) {
      await cn.query(
        `insert into deal_pilares (deal_id, pilar_id, price, cost) values ($1, $2, $3, $4)
         on conflict (deal_id, pilar_id) do update set price = excluded.price, cost = excluded.cost`,
        [dealId, i.pilarId, i.precio, i.costo],
      );
    }
    if (items.length > 0) await cn.query(`update deals set project_type = $2 where id = $1`, [dealId, resumenTexto(nombresEnOrden)]);
    await cn.query('commit');
  } catch (e) {
    await cn.query('rollback').catch(() => {});
    throw e;
  } finally {
    cn.release();
  }
  return leerRepartoDeal(dealId, veCostos);
}

// ── Muchos deals (pantalla de Pilares) ──────────────────────────────────────

export interface DealParaClasificar extends DealBasico {
  items: ItemReparto[];
  estado: ResumenReparto['estado'];
  asignado: number;
  falta: number;
  sobra: number;
  sugerencia: Sugerencia | null;
}

/** Todos los deals con su reparto, su estado y, si aún no tienen pilares, lo que sugiere su texto viejo de «Tipo de proyecto». */
export async function listarParaClasificar(): Promise<{ pilares: PilarCatalogo[]; deals: DealParaClasificar[] }> {
  const [pilares, tratos, reparto] = await Promise.all([
    listarPilares(),
    pool.query(`select ${COLUMNAS_DEAL} from deals d order by d.created_at desc, d.id`),
    pool.query(`select dp.deal_id, dp.pilar_id, dp.price, dp.cost from deal_pilares dp join pilares p on p.id = dp.pilar_id order by p.sort_order, lower(p.name)`),
  ]);
  const porDeal = new Map<string, ItemReparto[]>();
  for (const r of reparto.rows) {
    const lista = porDeal.get(r.deal_id) ?? [];
    lista.push({ pilarId: r.pilar_id, precio: r.price === null ? null : Number(r.price), costo: r.cost === null ? null : Number(r.cost) });
    porDeal.set(r.deal_id, lista);
  }
  const activos = pilares.filter(p => p.activo);
  const deals = tratos.rows.map(r => {
    const d = aDeal(r);
    const items = porDeal.get(d.id) ?? [];
    const resumen = estadoReparto(items, d.precio);
    return { ...d, items, ...resumen, sugerencia: items.length === 0 ? sugerirDesdeTexto(d.tipoProyecto, activos) : null };
  });
  return { pilares, deals };
}

async function pilarActivo(pilarId: string): Promise<PilarCatalogo> {
  const p = (await listarPilares()).find(x => x.id === pilarId);
  if (!p) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pilar no encontrado' });
  if (!p.activo) throw malaPeticion(`El pilar «${p.nombre}» está desactivado: actívalo antes de usarlo.`);
  return p;
}

/** Pone un solo pilar (100 %) a los deals de la lista que todavía no tienen ninguno; los que ya tienen reparto no se tocan. */
export async function asignarPilarEnLote(args: { dealIds: string[]; pilarId: string }): Promise<{ asignados: number; omitidos: number }> {
  if (args.dealIds.length > 1000) throw malaPeticion('Son demasiados deals a la vez.');
  const pilar = await pilarActivo(args.pilarId);
  const unicos = [...new Set(args.dealIds)];
  if (unicos.length === 0) return { asignados: 0, omitidos: 0 };
  const cn = await pool.connect();
  try {
    await cn.query('begin');
    const { rows } = await cn.query(
      `insert into deal_pilares (deal_id, pilar_id)
       select d.id, $2::uuid from deals d
        where d.id = any($1::uuid[]) and not exists (select 1 from deal_pilares x where x.deal_id = d.id)
       returning deal_id`,
      [unicos, pilar.id],
    );
    const nuevos = rows.map(r => r.deal_id as string);
    if (nuevos.length) await cn.query(`update deals set project_type = $2 where id = any($1::uuid[])`, [nuevos, pilar.nombre]);
    await cn.query('commit');
    return { asignados: nuevos.length, omitidos: unicos.length - nuevos.length };
  } catch (e) {
    await cn.query('rollback').catch(() => {});
    throw e;
  } finally {
    cn.release();
  }
}

/** Acepta lo que sugiere el texto viejo de «Tipo de proyecto» para los deals de la lista que no tienen reparto y cuyo texto nombra UN solo pilar; los que mezclan pilares se dejan para repartirlos a mano. */
export async function aceptarSugerencias(args: { dealIds: string[] }): Promise<{ aceptados: number; omitidos: number; mixtos: number }> {
  if (args.dealIds.length > 1000) throw malaPeticion('Son demasiados deals a la vez.');
  const unicos = [...new Set(args.dealIds)];
  if (unicos.length === 0) return { aceptados: 0, omitidos: 0, mixtos: 0 };
  const catalogo = (await listarPilares()).filter(p => p.activo);
  const { rows } = await pool.query(
    `select d.id, d.project_type from deals d where d.id = any($1::uuid[]) and not exists (select 1 from deal_pilares x where x.deal_id = d.id)`,
    [unicos],
  );
  const porPilar = new Map<string, string[]>();
  let mixtos = 0;
  for (const r of rows) {
    const s = sugerirDesdeTexto(r.project_type, catalogo);
    if (!s) continue;
    if (s.mixta) { mixtos++; continue; }
    porPilar.set(s.pilarIds[0], [...(porPilar.get(s.pilarIds[0]) ?? []), r.id]);
  }
  let aceptados = 0;
  for (const [pilarId, ids] of porPilar) aceptados += (await asignarPilarEnLote({ dealIds: ids, pilarId })).asignados;
  return { aceptados, omitidos: unicos.length - aceptados - mixtos, mixtos };
}
