// Pagos de análisis / management: lee los proyectos con lo que su deal dice de cada rubro y el reparto que Sergio ha registrado, y guarda ese reparto.
// Las tablas pagos_management_* las crea server/scripts/add-pagos-management-tables.ts (fuera de generate.py); todo el SQL vive aquí.
import { pool, ZiteError } from '../../../server/compat';
import {
  MAX_PERSONAS, MONEDAS, RUBROS, esPorOmision, redondear, rubrosPorOmision, validarReparto, validarRubros,
  type DealManagement, type Moneda, type PagosManagement, type PersonaReparto, type ProyectoDisponible, type ProyectoManagement, type Rubro, type RubroPresupuesto, type RubrosDeal,
  type UnidadCotizada, type UsuarioReparto,
} from '../../lib/pagosManagement/reparto';

/** Lo único que se necesita del pool: así las pruebas le pasan una base en memoria. */
export interface Consulta { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }
export interface BaseDeDatos extends Consulta { connect: () => Promise<Consulta & { release: () => void }> }

/** Postgres: la tabla no existe (todavía no se corrió add-pagos-management-tables.ts). */
export const faltaLaTabla = (err: unknown) => (err as { code?: string } | null)?.code === '42P01';
export const MENSAJE_SIN_TABLAS = 'Faltan las tablas de pagos de management en la base de datos (add-pagos-management-tables.ts).';

const nombreDe = (u: { first_name?: string | null; last_name?: string | null; email?: string | null }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || '';
const monedaDe = (texto?: string | null): Moneda => MONEDAS.find((m) => (texto ?? '').startsWith(m)) ?? 'MXN';
const sinNulos = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const numero = (v: unknown): number => Number(v ?? 0);

// Lo que un deal dice de cada rubro es lo que sale en la pestaña Presupuesto del proyecto (getProjectBudget): las líneas del rubro en las
// cotizaciones incluidas, sin las excluidas del presupuesto y con total mayor a cero. «costo» es cantidad × componentes × costo unitario.
const RUBROS_DEL_DEAL = `
  with por_rubro as (
    select c.deal_id, li.rubro,
           sum(coalesce(li.cantidad, 1) * coalesce(li.componentes, 1) * coalesce(li.unit_cost, 0)) as costo,
           sum(coalesce(li.final_price, 0)) as con_markup
      from cotizaciones c
      join cotizacion_line_items li on li.cotizacion_id = c.id
     where c.included is true and li.rubro is not null and li.included_in_budget is not false
       and coalesce(li.cantidad, 1) * coalesce(li.componentes, 1) * coalesce(li.unit_cost, 0) > 0
     group by c.deal_id, li.rubro
  ), rubros_deal as (
    select deal_id, jsonb_object_agg(rubro, jsonb_build_object('costo', costo, 'conMarkup', con_markup)) as rubros
      from por_rubro
     group by deal_id
  )`;

const rubrosDelDeal = (json: unknown): RubrosDeal => {
  const salida: RubrosDeal = {};
  if (json && typeof json === 'object') {
    for (const rubro of RUBROS) {
      const v = (json as Record<string, { costo?: unknown; conMarkup?: unknown } | undefined>)[rubro];
      if (v) salida[rubro] = { costo: numero(v.costo), conMarkup: numero(v.conMarkup) };
    }
  }
  return salida;
};

export async function listarPagosManagement(db: Consulta = pool): Promise<PagosManagement> {
  const sinTablas = !(await db.query(
    `select to_regclass('pagos_management_proyectos') is not null and to_regclass('pagos_management_personas') is not null
        and to_regclass('pagos_management_rubros') is not null as existe`,
  )).rows[0]?.existe;
  const registro = sinTablas
    ? { columnas: `, null::uuid as reparto_id, null::text as moneda`, unir: '' }
    : { columnas: `, r.id as reparto_id, r.moneda`, unir: 'left join pagos_management_proyectos r on r.project_id = p.id' };

  const [proyectosBD, usuariosBD, dealsBD] = await Promise.all([
    // El deal de un proyecto, para esto, es el que se le asignó aquí o, si no, el vinculado.
    db.query(`${RUBROS_DEL_DEAL}
      select p.id as project_id, p.project_code, p.full_name, p.client, p.status, p.start_date::text as start_date,
             p.deal_vinculado_id, p.deal_asignado_id, dv.deal_name as deal_vinculado_nombre, coalesce(p.deal_asignado_id, p.deal_vinculado_id) as deal_id,
             d.deal_name, d.currency as deal_currency, coalesce(m.rubros, '{}'::jsonb) as rubros_deal${registro.columnas}
        from projects p
        left join deals dv on dv.id = p.deal_vinculado_id
        left join deals d on d.id = coalesce(p.deal_asignado_id, p.deal_vinculado_id)
        left join rubros_deal m on m.deal_id = coalesce(p.deal_asignado_id, p.deal_vinculado_id)
        ${registro.unir}
       where p.project_code is not null
       order by p.start_date desc nulls last, p.project_code`),
    db.query(`select id, first_name, last_name, email, departamento from users order by first_name nulls last, last_name nulls last, email`),
    // Los deals con Management cotizado a los que se les asignan proyectos: los ganados y los que ya tienen algún proyecto (vinculado o asignado).
    db.query(`${RUBROS_DEL_DEAL}
      select d.id as deal_id, d.deal_name, d.client, d.currency, coalesce(d.approval_date, d.proposal_date)::text as fecha, m.rubros -> 'Management' as management
        from deals d
        join rubros_deal m on m.deal_id = d.id
       where (m.rubros -> 'Management') is not null
         and (d.phase = 'Ganado'
              or d.id in (select deal_vinculado_id from projects where deal_vinculado_id is not null)
              or d.id in (select deal_asignado_id from projects where deal_asignado_id is not null))
       order by d.deal_name`),
  ]);
  const unidadesBD = dealsBD.rows.length === 0 ? { rows: [] as any[] } : await db.query(
    // Cómo se cotizó el Management de esos deals, por precio unitario: «40 × $2,000».
    `select c.deal_id, li.unit_cost as precio, sum(coalesce(li.cantidad, 1) * coalesce(li.componentes, 1)) as cantidad
       from cotizaciones c join cotizacion_line_items li on li.cotizacion_id = c.id
      where c.deal_id = any($1::uuid[]) and c.included is true and li.rubro = 'Management' and li.included_in_budget is not false
        and coalesce(li.cantidad, 1) * coalesce(li.componentes, 1) * coalesce(li.unit_cost, 0) > 0
      group by c.deal_id, li.unit_cost
      order by c.deal_id, li.unit_cost`,
    [dealsBD.rows.map((f) => f.deal_id)],
  );

  const personasPorReparto = new Map<string, PersonaReparto[]>();
  const rubrosPorReparto = new Map<string, RubroPresupuesto[]>();
  let huerfanos: any[] = [];
  const externos = new Set<string>();
  if (!sinTablas) {
    const personasBD = await db.query(
      `select pp.id, pp.reparto_id, pp.user_id, pp.nombre, pp.externo, pp.porcentaje, u.first_name, u.last_name, u.email
         from pagos_management_personas pp left join users u on u.id = pp.user_id
        order by pp.reparto_id, pp.orden, pp.created_at`,
    );
    for (const f of personasBD.rows) {
      const persona: PersonaReparto = {
        id: f.id, userId: f.user_id ?? null, externo: !!f.externo, porcentaje: numero(f.porcentaje),
        // Un usuario interno se muestra con su nombre de hoy; si ya no existe, con el que tenía al repartir.
        nombre: f.externo ? f.nombre : nombreDe(f) || f.nombre,
      };
      const lista = personasPorReparto.get(f.reparto_id);
      if (lista) lista.push(persona); else personasPorReparto.set(f.reparto_id, [persona]);
      if (f.externo) externos.add(f.nombre);
    }
    const rubrosBD = await db.query(`select reparto_id, rubro, monto from pagos_management_rubros order by reparto_id, orden, created_at`);
    for (const f of rubrosBD.rows) {
      const rubro: RubroPresupuesto = { rubro: f.rubro as Rubro, monto: f.monto === null || f.monto === undefined ? null : numero(f.monto) };
      const lista = rubrosPorReparto.get(f.reparto_id);
      if (lista) lista.push(rubro); else rubrosPorReparto.set(f.reparto_id, [rubro]);
    }
    huerfanos = (await db.query(`select id as reparto_id, project_codigo, moneda from pagos_management_proyectos where project_id is null order by updated_at desc`)).rows;
  }

  // Un deal con varios proyectos está fragmentado: su Management se reparte entre ellos, no es de ninguno en particular.
  const proyectosPorDeal = new Map<string, number>();
  for (const f of proyectosBD.rows) if (f.deal_id) proyectosPorDeal.set(f.deal_id, (proyectosPorDeal.get(f.deal_id) ?? 0) + 1);

  const proyectos: ProyectoManagement[] = [];
  const disponibles: ProyectoDisponible[] = [];
  for (const f of proyectosBD.rows) {
    const monedaDeal = monedaDe(f.deal_currency);
    const rubrosDeal = rubrosDelDeal(f.rubros_deal);
    const rubrosGuardados: RubroPresupuesto[] | undefined = rubrosPorReparto.get(f.reparto_id);
    const dealFragmentado = !!f.deal_id && (proyectosPorDeal.get(f.deal_id) ?? 0) >= 2;
    // Si el deal se reparte entre varios proyectos, o es otro que el vinculado, su Management no se le ofrece a este como suyo (cada proyecto se lleva
    // lo que se le ponga y, si no, se contaría varias veces). Un reparto ya guardado que sigue al deal (sin monto puesto) se respeta tal cual.
    const sigueAlDeal = rubrosGuardados?.some((r) => r.rubro === 'Management' && r.monto === null) ?? false;
    if ((dealFragmentado || f.deal_asignado_id) && !sigueAlDeal) delete rubrosDeal.Management;
    const delDeal = {
      dealId: f.deal_id ?? null, dealVinculadoId: f.deal_vinculado_id ?? null, dealAsignadoId: f.deal_asignado_id ?? null,
      ...(f.deal_vinculado_nombre ? { dealVinculadoNombre: f.deal_vinculado_nombre as string } : {}), ...(dealFragmentado ? { dealFragmentado: true } : {}),
    };
    // Sin reparto y sin management en el deal no hay nada que repartir todavía: se puede agregar a mano.
    if (!f.reparto_id && (rubrosDeal.Management?.costo ?? 0) <= 0) {
      disponibles.push({
        projectId: f.project_id, codigo: f.project_code, nombre: sinNulos(f.full_name), cliente: sinNulos(f.client), estado: sinNulos(f.status),
        inicio: sinNulos(f.start_date), dealNombre: sinNulos(f.deal_name), monedaDeal, rubrosDeal, ...delDeal,
      });
      continue;
    }
    proyectos.push({
      repartoId: f.reparto_id ?? null, projectId: f.project_id, codigo: f.project_code, nombre: sinNulos(f.full_name), cliente: sinNulos(f.client), estado: sinNulos(f.status),
      inicio: sinNulos(f.start_date), dealNombre: sinNulos(f.deal_name), rubrosDeal, monedaDeal,
      // Sin rubros guardados (un reparto sin tocar) vale lo de siempre: el Management del deal.
      rubros: rubrosGuardados ?? rubrosPorOmision(),
      moneda: f.moneda ? monedaDe(f.moneda) : monedaDeal, personas: personasPorReparto.get(f.reparto_id) ?? [], eliminado: false, ...delDeal,
    });
  }

  const unidadesPorDeal = new Map<string, UnidadCotizada[]>();
  for (const f of unidadesBD.rows) {
    const unidad: UnidadCotizada = { precio: numero(f.precio), cantidad: numero(f.cantidad) };
    const lista = unidadesPorDeal.get(f.deal_id);
    if (lista) lista.push(unidad); else unidadesPorDeal.set(f.deal_id, [unidad]);
  }
  const deals: DealManagement[] = dealsBD.rows.map((f) => ({
    dealId: f.deal_id, nombre: f.deal_name ?? '', cliente: sinNulos(f.client), moneda: monedaDe(f.currency), cotizado: redondear(numero(f.management?.costo)),
    unidades: unidadesPorDeal.get(f.deal_id) ?? [], ...(f.fecha ? { inicio: f.fecha as string } : {}),
  }));
  // Repartos de proyectos que se eliminaron: se conservan y se ven, porque lo repartido sigue siendo plata que se debe.
  for (const f of huerfanos) {
    proyectos.push({
      repartoId: f.reparto_id, projectId: null, codigo: f.project_codigo, rubrosDeal: {}, monedaDeal: 'MXN',
      rubros: rubrosPorReparto.get(f.reparto_id) ?? rubrosPorOmision(), moneda: monedaDe(f.moneda), personas: personasPorReparto.get(f.reparto_id) ?? [], eliminado: true,
    });
  }

  return {
    proyectos, disponibles, deals, sinTablas,
    usuarios: usuariosBD.rows.filter((u) => nombreDe(u)).map((u): UsuarioReparto => ({ id: u.id, nombre: nombreDe(u), departamento: sinNulos(u.departamento) })),
    externos: [...externos].sort((a, b) => a.localeCompare(b)),
  };
}

export interface EntradaReparto {
  projectId: string;
  /** Los rubros que forman el presupuesto; `monto` null (o sin ponerlo) = vale lo que dice el deal de ese rubro. */
  rubros: Array<{ rubro: Rubro; monto?: number | null }>;
  moneda?: Moneda | null;
  personas: Array<{ userId?: string | null; nombre: string; externo: boolean; porcentaje: number }>;
  /**
   * El deal del que sale el Management del proyecto. Sin ponerlo no se toca lo que ya tenía; null (o el deal vinculado) es que el proyecto sigue a su
   * deal vinculado; otro deal se guarda como el asignado, y entonces el Management se escribe (es una parte de lo cotizado por ese deal).
   */
  dealId?: string | null;
}

const redondear6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Guarda el reparto de un proyecto: reemplaza los rubros del presupuesto y las personas que había. Con solo el Management del deal (sin tocar) y
 * sin personas borra el reparto (el proyecto vuelve a quedar «sin repartir»). El porcentaje de cada persona se guarda; los montos se calculan
 * siempre sobre el presupuesto de hoy.
 */
export async function guardarReparto(entrada: EntradaReparto, quien: string, db: BaseDeDatos = pool): Promise<{ eliminado: boolean }> {
  const personas: PersonaReparto[] = entrada.personas.map((p) => ({ userId: p.externo ? null : p.userId ?? null, nombre: p.nombre.trim(), externo: p.externo, porcentaje: redondear6(p.porcentaje) }));
  const problema = validarReparto(personas);
  if (problema) throw new ZiteError({ code: 'BAD_REQUEST', message: problema });
  const rubros: RubroPresupuesto[] = entrada.rubros.map((r) => ({ rubro: r.rubro, monto: r.monto == null ? null : redondear(r.monto) }));
  const problemaRubros = validarRubros(rubros);
  if (problemaRubros) throw new ZiteError({ code: 'BAD_REQUEST', message: problemaRubros });
  if (personas.length > MAX_PERSONAS) throw new ZiteError({ code: 'BAD_REQUEST', message: `Un reparto no puede tener más de ${MAX_PERSONAS} personas.` });

  try {
    const proyecto = (await db.query(`select id, project_code, deal_vinculado_id, deal_asignado_id from projects where id = $1`, [entrada.projectId])).rows[0];
    if (!proyecto) throw new ZiteError({ code: 'NOT_FOUND', message: 'El proyecto no existe.' });

    // El deal que se guarda como asignado: ninguno si es el vinculado (el proyecto lo sigue) o si no se eligió ninguno; sin ponerlo no se toca.
    const dealAsignado: string | null | undefined = entrada.dealId === undefined ? undefined : entrada.dealId && entrada.dealId !== proyecto.deal_vinculado_id ? entrada.dealId : null;
    const asignadoVigente: string | null = (dealAsignado === undefined ? proyecto.deal_asignado_id : dealAsignado) ?? null;
    // El deal del que sale su Management: el asignado o, si no, el vinculado.
    const dealEfectivo: string | null = asignadoVigente ?? proyecto.deal_vinculado_id ?? null;
    const deal = dealEfectivo ? (await db.query(
      `${RUBROS_DEL_DEAL}
       select d.id, d.deal_name, d.currency, coalesce((m.rubros -> 'Management' ->> 'costo')::numeric, 0) as management
         from deals d left join rubros_deal m on m.deal_id = d.id where d.id = $1`,
      [dealEfectivo],
    )).rows[0] : undefined;
    if (dealAsignado && !deal) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El deal elegido ya no existe.' });

    // La moneda solo se guarda si algún monto se puso a mano; si no, valen la moneda y los montos del deal. Con otra moneda no hay montos del deal
    // que valgan (están en la del deal), así que todos van a mano.
    const monedaDeal = monedaDe(deal?.currency);
    if (entrada.moneda && entrada.moneda !== monedaDeal && rubros.some((r) => r.monto === null)) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: `Con una moneda distinta a la del deal (${monedaDeal}) hay que escribir el monto de cada rubro.` });
    }
    const moneda: Moneda | null = rubros.some((r) => r.monto !== null) ? entrada.moneda ?? monedaDeal : null;

    // Un proyecto con otro deal que el vinculado se lleva una parte de su Management: tiene que ser un monto (no hay «el del deal», sería todo), en la
    // moneda del deal, y el deal tiene que tener Management cotizado.
    if (asignadoVigente && deal) {
      if (!(numero(deal.management) > 0)) throw new ZiteError({ code: 'BAD_REQUEST', message: `El deal «${deal.deal_name}» no tiene Management cotizado.` });
      if (moneda !== null && moneda !== monedaDeal) {
        throw new ZiteError({ code: 'BAD_REQUEST', message: `El deal «${deal.deal_name}» está en ${monedaDeal}: pon los montos en ${monedaDeal}.` });
      }
      const management = rubros.find((r) => r.rubro === 'Management');
      if (!management) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Un proyecto con otro deal necesita el rubro Management.' });
      if (!((management.monto ?? 0) > 0)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe cuánto Management se lleva este proyecto del deal.' });
    }

    // A los usuarios internos se les guarda su nombre de hoy, tomado de la base y no de lo que mande la pantalla.
    const ids = personas.filter((p) => !p.externo).map((p) => p.userId as string);
    const nombres = new Map<string, string>();
    if (ids.length) {
      const usuarios = (await db.query(`select id, first_name, last_name, email from users where id = any($1::uuid[])`, [ids])).rows;
      for (const u of usuarios) nombres.set(u.id, nombreDe(u));
      if (ids.some((id) => !nombres.has(id))) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Una de las personas elegidas ya no existe entre los usuarios.' });
    }

    if (personas.length === 0 && esPorOmision(rubros)) {
      await db.query(`delete from pagos_management_proyectos where project_id = $1`, [entrada.projectId]);
      if (dealAsignado !== undefined) await db.query(`update projects set deal_asignado_id = $2 where id = $1`, [entrada.projectId, dealAsignado]);
      return { eliminado: true };
    }

    const filasPersonas = personas.map((p, i) => ({ user_id: p.userId, nombre: p.externo ? p.nombre : nombres.get(p.userId as string) ?? p.nombre, externo: p.externo, porcentaje: p.porcentaje, orden: i }));
    const filasRubros = rubros.map((r, i) => ({ rubro: r.rubro, monto: r.monto, orden: i }));
    const client = await db.connect();
    try {
      await client.query('begin');
      // `presupuesto` es de la primera versión (un solo monto): ya no se usa y se limpia.
      const reparto = (await client.query(
        `insert into pagos_management_proyectos (project_id, project_codigo, presupuesto, moneda, actualizado_por) values ($1, $2, null, $3, $4)
         on conflict (project_id) do update set project_codigo = excluded.project_codigo, presupuesto = null, moneda = excluded.moneda,
                                                actualizado_por = excluded.actualizado_por, updated_at = now()
         returning id`,
        [entrada.projectId, proyecto.project_code, moneda, quien],
      )).rows[0] as { id: string };
      await client.query(`delete from pagos_management_rubros where reparto_id = $1`, [reparto.id]);
      await client.query(
        `insert into pagos_management_rubros (reparto_id, rubro, monto, orden)
         select $1::uuid, x.rubro, x.monto, x.orden from jsonb_to_recordset($2::jsonb) as x(rubro text, monto numeric, orden int)`,
        [reparto.id, JSON.stringify(filasRubros)],
      );
      if (dealAsignado !== undefined) await client.query(`update projects set deal_asignado_id = $2 where id = $1`, [entrada.projectId, dealAsignado]);
      await client.query(`delete from pagos_management_personas where reparto_id = $1`, [reparto.id]);
      if (filasPersonas.length) {
        await client.query(
          `insert into pagos_management_personas (reparto_id, user_id, nombre, externo, porcentaje, orden)
           select $1::uuid, x.user_id::uuid, x.nombre, x.externo, x.porcentaje, x.orden
             from jsonb_to_recordset($2::jsonb) as x(user_id text, nombre text, externo boolean, porcentaje numeric, orden int)`,
          [reparto.id, JSON.stringify(filasPersonas)],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { eliminado: false };
  } catch (err) {
    if (faltaLaTabla(err)) throw new ZiteError({ code: 'INTERNAL_ERROR', message: MENSAJE_SIN_TABLAS });
    throw err;
  }
}
