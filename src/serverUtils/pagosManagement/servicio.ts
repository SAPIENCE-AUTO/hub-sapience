// Pagos de análisis / management: lee los proyectos con lo que su deal dice de cada rubro y el reparto que Sergio ha registrado, y guarda ese reparto.
// Las tablas pagos_management_* las crea server/scripts/add-pagos-management-tables.ts (fuera de generate.py); todo el SQL vive aquí.
import { pool, ZiteError } from '../../../server/compat';
import {
  MAX_PERSONAS, MONEDAS, RUBROS, esPorOmision, redondear, rubrosPorOmision, validarReparto, validarRubros,
  type Moneda, type PagosManagement, type PersonaReparto, type ProyectoDisponible, type ProyectoManagement, type Rubro, type RubroPresupuesto, type RubrosDeal, type UsuarioReparto,
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

  const [proyectosBD, usuariosBD] = await Promise.all([
    db.query(`${RUBROS_DEL_DEAL}
      select p.id as project_id, p.project_code, p.full_name, p.client, p.status, p.start_date::text as start_date,
             d.deal_name, d.currency as deal_currency, coalesce(m.rubros, '{}'::jsonb) as rubros_deal${registro.columnas}
        from projects p
        left join deals d on d.id = p.deal_vinculado_id
        left join rubros_deal m on m.deal_id = p.deal_vinculado_id
        ${registro.unir}
       where p.project_code is not null
       order by p.start_date desc nulls last, p.project_code`),
    db.query(`select id, first_name, last_name, email, departamento from users order by first_name nulls last, last_name nulls last, email`),
  ]);

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

  const proyectos: ProyectoManagement[] = [];
  const disponibles: ProyectoDisponible[] = [];
  for (const f of proyectosBD.rows) {
    const monedaDeal = monedaDe(f.deal_currency);
    const rubrosDeal = rubrosDelDeal(f.rubros_deal);
    // Sin reparto y sin management en el deal no hay nada que repartir todavía: se puede agregar a mano.
    if (!f.reparto_id && (rubrosDeal.Management?.costo ?? 0) <= 0) {
      disponibles.push({
        projectId: f.project_id, codigo: f.project_code, nombre: sinNulos(f.full_name), cliente: sinNulos(f.client), estado: sinNulos(f.status),
        inicio: sinNulos(f.start_date), dealNombre: sinNulos(f.deal_name), monedaDeal, rubrosDeal,
      });
      continue;
    }
    proyectos.push({
      repartoId: f.reparto_id ?? null, projectId: f.project_id, codigo: f.project_code, nombre: sinNulos(f.full_name), cliente: sinNulos(f.client), estado: sinNulos(f.status),
      inicio: sinNulos(f.start_date), dealNombre: sinNulos(f.deal_name), rubrosDeal, monedaDeal,
      // Sin rubros guardados (un reparto sin tocar) vale lo de siempre: el Management del deal.
      rubros: rubrosPorReparto.get(f.reparto_id) ?? rubrosPorOmision(),
      moneda: f.moneda ? monedaDe(f.moneda) : monedaDeal, personas: personasPorReparto.get(f.reparto_id) ?? [], eliminado: false,
    });
  }
  // Repartos de proyectos que se eliminaron: se conservan y se ven, porque lo repartido sigue siendo plata que se debe.
  for (const f of huerfanos) {
    proyectos.push({
      repartoId: f.reparto_id, projectId: null, codigo: f.project_codigo, rubrosDeal: {}, monedaDeal: 'MXN',
      rubros: rubrosPorReparto.get(f.reparto_id) ?? rubrosPorOmision(), moneda: monedaDe(f.moneda), personas: personasPorReparto.get(f.reparto_id) ?? [], eliminado: true,
    });
  }

  return {
    proyectos, disponibles, sinTablas,
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
    const proyecto = (await db.query(
      `select p.id, p.project_code, d.currency as deal_currency from projects p left join deals d on d.id = p.deal_vinculado_id where p.id = $1`,
      [entrada.projectId],
    )).rows[0];
    if (!proyecto) throw new ZiteError({ code: 'NOT_FOUND', message: 'El proyecto no existe.' });

    // La moneda solo se guarda si algún monto se puso a mano; si no, valen la moneda y los montos del deal. Con otra moneda no hay montos del deal
    // que valgan (están en la del deal), así que todos van a mano.
    const monedaDeal = monedaDe(proyecto.deal_currency);
    if (entrada.moneda && entrada.moneda !== monedaDeal && rubros.some((r) => r.monto === null)) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: `Con una moneda distinta a la del deal (${monedaDeal}) hay que escribir el monto de cada rubro.` });
    }
    const moneda: Moneda | null = rubros.some((r) => r.monto !== null) ? entrada.moneda ?? monedaDeal : null;

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
