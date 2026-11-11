import { pool } from '../../../server/compat';
import {
  MAX_LARGO_PIEZA, MAX_PIEZAS_POR_COLUMNA, MAX_VALORES_DISTINTOS, MIN_FILAS_POR_PIEZA,
  entraAlCatalogo, esPiezaPersonal, limpiarEtiqueta, limpiarPieza, modoDeColumna, normalizarTexto, type ModoDeColumna,
} from '../../lib/busqueda/texto';

// El catálogo del buscador de gente: de cada tablero de reclutamiento, qué preguntas tiene (el nombre de cada columna) y qué respondió la gente (las respuestas que se repiten y cuántas filas las dieron).
// Se arma en la base (una sola consulta por tablero, sin traer filas de personas) y solo lee: lo único que escribe son las tablas del buscador (almacen.ts). Nunca guarda datos personales: salen de
// la lectura las columnas de nombre, teléfono, correo, dirección o identificación y las de nombres de reclutadores; una respuesta que parece un dato de una persona (correo, teléfono o número largo, liga o usuario de
// red, clave tipo CURP o RFC) no se guarda aunque esté en una columna de nombre inocente, y tampoco una que dieron menos de MIN_FILAS_POR_PIEZA filas.

export type Consulta = { query: (texto: string, valores?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }> };

export interface PiezaCatalogo { pieza: string; etiqueta: string; filas: number; primero: number | null }
export interface ColumnaCatalogo {
  columnaId: string;
  nombre: string;
  nombreNorm: string;
  respondieron: number;
  distintos: number;
  modo: ModoDeColumna;
  piezas: PiezaCatalogo[];
}
export interface TableroACatalogar {
  id: string;
  nombre: string;
  proyecto: string | null;
  cliente: string | null;
  fechaInicio: string | null;
  filas: number;
  fuenteActualizada: Date | null;
}

// Una consulta por tablero. «pares»: cada respuesta de texto de las columnas permitidas. «card»: de cada columna, cuántas filas respondieron y cuántos textos distintos. Si la columna tiene pocos
// textos distintos y cada uno se repite (opciones como «Es mi top / favorita»), se cuentan los textos enteros («valores»); si no (cada quien escribió su lista o su texto), se parte en piezas por coma,
// punto y coma, salto de línea o barra («listas») y se cuenta en cuántas filas sale cada pieza, y cuántas veces es la primera de la lista (la «favorita» de un ranking). La regla de pocos textos
// distintos es la misma de `modoDeColumna` (src/lib/busqueda/texto.ts): si se cambia una, se cambia la otra.
const SQL_LEER_TABLERO = `
with pares as (
  select r.id as fila, e.key as col, btrim(e.value->>'textValue') as v
  from recruitment_rows r, jsonb_each(r.cell_data::jsonb) e
  where r.board_id = $1 and (r.deleted_at is null or r.deleted_at = '')
    and r.cell_data is not null and r.cell_data <> '' and r.cell_data <> '{}'
    and e.value ? 'textValue' and btrim(e.value->>'textValue') <> ''
    and e.key = any($2::text[])
), card as (
  select col, count(*)::int as n, count(distinct v)::int as d from pares group by col
), valores as (
  select p.col, lower(p.v) as pieza, count(*)::int as filas
  from pares p join card c on c.col = p.col
  where c.d <= $3 and c.d * 2 <= c.n and length(p.v) <= $4
  group by p.col, lower(p.v)
), listas as (
  select col, pieza, filas, primero from (
    select p.col, lower(btrim(x.pieza)) as pieza, count(distinct p.fila)::int as filas,
           (count(distinct p.fila) filter (where x.ord = 1))::int as primero,
           row_number() over (partition by p.col order by count(distinct p.fila) desc, lower(btrim(x.pieza))) as pos
    from pares p join card c on c.col = p.col
    cross join lateral regexp_split_to_table(p.v, '[,;\\n\\r|•]+') with ordinality as x(pieza, ord)
    where not (c.d <= $3 and c.d * 2 <= c.n) and btrim(x.pieza) <> '' and length(btrim(x.pieza)) <= $4
    group by p.col, lower(btrim(x.pieza))
    having count(distinct p.fila) >= 2
  ) z where pos <= 400
)
select 'c' as tipo, col, null::text as pieza, n as filas, d as primero from card
union all select 'v', col, pieza, filas, null::int from valores
union all select 'l', col, pieza, filas, primero from listas
`;

/** Las preguntas de un tablero con sus respuestas que se repiten. Las columnas que son datos personales o no son preguntas no se leen. */
export async function leerCatalogoDeTablero(consulta: Consulta, tableroId: string): Promise<ColumnaCatalogo[]> {
  const { rows: columnas } = await consulta.query(
    `select id::text as id, column_name, column_type from board_columns where board_id = $1 and (deleted_at is null or deleted_at = '')`,
    [tableroId],
  );
  const nombres = new Map<string, string>();
  for (const c of columnas) if (entraAlCatalogo(c.column_type, c.column_name)) nombres.set(String(c.id), String(c.column_name));
  if (nombres.size === 0) return [];

  const { rows } = await consulta.query(SQL_LEER_TABLERO, [tableroId, [...nombres.keys()], MAX_VALORES_DISTINTOS, 120]);
  const porColumna = new Map<string, { n: number; d: number; piezas: Map<string, { filas: number; primero: number; etiqueta: string; filasEtiqueta: number }> }>();
  for (const r of rows) {
    const id = String(r.col);
    let c = porColumna.get(id);
    if (!c) { c = { n: 0, d: 0, piezas: new Map() }; porColumna.set(id, c); }
    if (r.tipo === 'c') { c.n = Number(r.filas); c.d = Number(r.primero); continue; }
    // Se juntan las variantes (mayúsculas, acentos, viñetas, signos de los bordes): «Corona», «corona » y «1) CORONA» son una.
    const pieza = limpiarPieza(r.pieza);
    if (!pieza || pieza.length > MAX_LARGO_PIEZA || esPiezaPersonal(r.pieza)) continue;
    const p = c.piezas.get(pieza) ?? { filas: 0, primero: 0, etiqueta: '', filasEtiqueta: 0 };
    p.filas += Number(r.filas);
    if (r.tipo === 'l') p.primero += Number(r.primero ?? 0);
    // Para mostrarla, la forma de escribirla (con acentos) que más filas tuvo.
    if (Number(r.filas) > p.filasEtiqueta) { p.etiqueta = limpiarEtiqueta(r.pieza); p.filasEtiqueta = Number(r.filas); }
    c.piezas.set(pieza, p);
  }

  const salida: ColumnaCatalogo[] = [];
  for (const [id, c] of porColumna) {
    const nombre = nombres.get(id);
    if (!nombre || c.n <= 0) continue;
    const modo = modoDeColumna(c.n, c.d);
    const piezas = [...c.piezas]
      .filter(([, v]) => v.filas >= MIN_FILAS_POR_PIEZA)
      .sort((a, b) => b[1].filas - a[1].filas || a[0].localeCompare(b[0]))
      .slice(0, MAX_PIEZAS_POR_COLUMNA)
      .map(([pieza, v]) => ({ pieza, etiqueta: v.etiqueta || pieza, filas: v.filas, primero: modo === 'lista' ? v.primero : null }));
    salida.push({ columnaId: id, nombre, nombreNorm: normalizarTexto(nombre), respondieron: c.n, distintos: c.d, modo, piezas });
  }
  return salida;
}

const TANDA_PIEZAS = 5000;

/** Reemplaza lo que el catálogo sabía de un tablero por lo leído ahora, todo en una transacción (si algo falla, queda lo de antes). */
export async function guardarCatalogoDeTablero(cn: Consulta, tablero: TableroACatalogar, columnas: ColumnaCatalogo[]): Promise<void> {
  await cn.query('begin');
  try {
    await cn.query(`delete from busqueda_tableros where tablero_id = $1`, [tablero.id]);
    await cn.query(
      `insert into busqueda_tableros (tablero_id, proyecto, tablero, cliente, fecha_inicio, filas, columnas, fuente_actualizada, leido)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, now())`,
      [tablero.id, tablero.proyecto, tablero.nombre, tablero.cliente, tablero.fechaInicio, tablero.filas, columnas.length, tablero.fuenteActualizada],
    );
    if (columnas.length > 0) {
      const { rows } = await cn.query(
        `insert into busqueda_columnas (tablero_id, columna_id, nombre, nombre_norm, respondieron, distintos, modo)
         select $1::text, t.* from unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[]) as t
         returning id::text as id, columna_id`,
        [
          tablero.id, columnas.map((c) => c.columnaId), columnas.map((c) => c.nombre), columnas.map((c) => c.nombreNorm),
          columnas.map((c) => c.respondieron), columnas.map((c) => c.distintos), columnas.map((c) => c.modo),
        ],
      );
      const idDe = new Map(rows.map((r) => [String(r.columna_id), String(r.id)]));
      const col: string[] = [], pieza: string[] = [], etiqueta: string[] = [], filas: number[] = [], primero: Array<number | null> = [];
      for (const c of columnas) {
        for (const p of c.piezas) { col.push(idDe.get(c.columnaId)!); pieza.push(p.pieza); etiqueta.push(p.etiqueta); filas.push(p.filas); primero.push(p.primero); }
      }
      for (let i = 0; i < col.length; i += TANDA_PIEZAS) {
        await cn.query(
          `insert into busqueda_piezas (columna, pieza, etiqueta, filas, primero)
           select * from unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::int[]) on conflict do nothing`,
          [col.slice(i, i + TANDA_PIEZAS), pieza.slice(i, i + TANDA_PIEZAS), etiqueta.slice(i, i + TANDA_PIEZAS), filas.slice(i, i + TANDA_PIEZAS), primero.slice(i, i + TANDA_PIEZAS)],
        );
      }
    }
    await cn.query('commit');
  } catch (e) {
    await cn.query('rollback').catch(() => {});
    throw e;
  }
}

/** Los tableros de reclutamiento vivos con filas, con su proyecto, su cliente y lo más reciente que cambió en ellos (filas o columnas). */
export async function listarTablerosACatalogar(consulta: Consulta): Promise<TableroACatalogar[]> {
  const { rows } = await consulta.query(
    `select b.id::text as id, b.board_name, b.project_code, coalesce(r.filas, 0)::int as filas,
            r.actualizada as filas_actualizadas, c.actualizada as columnas_actualizadas, p.client, p.start_date::text as start_date
     from boards b
     left join (select board_id, count(*) as filas, max(updated_at) as actualizada from recruitment_rows
                where (deleted_at is null or deleted_at = '') group by board_id) r on r.board_id = b.id::text
     left join (select board_id, max(updated_at) as actualizada from board_columns group by board_id) c on c.board_id = b.id::text
     left join (select distinct on (project_code) project_code, client, start_date from projects
                where project_code is not null order by project_code, updated_at desc) p on p.project_code = b.project_code
     where b.deleted_at is null and b.board_type = 'recruitment'
     order by b.board_name`,
  );
  const fecha = (x: unknown) => (x ? new Date(x as string | Date) : null);
  return rows
    .filter((r) => Number(r.filas) > 0)
    .map((r) => {
      const a = fecha(r.filas_actualizadas), b = fecha(r.columnas_actualizadas);
      return {
        id: String(r.id), nombre: String(r.board_name ?? ''), proyecto: (r.project_code as string | null) ?? null, cliente: (r.client as string | null) ?? null,
        fechaInicio: (r.start_date as string | null) ?? null, filas: Number(r.filas),
        fuenteActualizada: a && b ? (a > b ? a : b) : a ?? b,
      };
    });
}

export interface ResumenCatalogo {
  tableros: number;
  leidos: number;
  sinCambios: number;
  quitados: number;
  fallidos: Array<{ tablero: string; error: string }>;
  milisegundos: number;
}

/**
 * Lee los tableros nuevos o que cambiaron desde la última vez (o todos con `forzar`) y quita del catálogo los que ya no existen. Un tablero que falla no detiene a los demás: queda en `fallidos`.
 * Solo lee los tableros; solo escribe las tablas del buscador.
 */
export async function actualizarCatalogo(opciones: {
  consulta?: Consulta;
  forzar?: boolean;
  alAvanzar?: (hechos: number, total: number, tablero: string) => void;
} = {}): Promise<ResumenCatalogo> {
  const consulta = opciones.consulta ?? pool;
  const t0 = Date.now();
  const tableros = await listarTablerosACatalogar(consulta);
  const { rows: previos } = await consulta.query(`select tablero_id, fuente_actualizada, filas from busqueda_tableros`);
  const previo = new Map(previos.map((r) => [String(r.tablero_id), r]));

  const vivos = new Set(tableros.map((t) => t.id));
  const quitar = [...previo.keys()].filter((id) => !vivos.has(id));
  if (quitar.length > 0) await consulta.query(`delete from busqueda_tableros where tablero_id = any($1::text[])`, [quitar]);

  const cambio = (t: TableroACatalogar): boolean => {
    const p = previo.get(t.id);
    if (!p || opciones.forzar) return true;
    if (Number(p.filas) !== t.filas) return true;
    const antes = p.fuente_actualizada ? new Date(p.fuente_actualizada).getTime() : 0;
    return (t.fuenteActualizada?.getTime() ?? 0) > antes;
  };
  const aLeer = tableros.filter(cambio);
  const fallidos: ResumenCatalogo['fallidos'] = [];
  let hechos = 0;
  for (const t of aLeer) {
    try {
      const columnas = await leerCatalogoDeTablero(consulta, t.id);
      const cn = await pool.connect();
      try { await guardarCatalogoDeTablero(cn, t, columnas); } finally { cn.release(); }
    } catch (e) {
      fallidos.push({ tablero: t.nombre, error: ((e as Error).message ?? String(e)).split('\n')[0].slice(0, 200) });
    }
    opciones.alAvanzar?.(++hechos, aLeer.length, t.nombre);
  }
  return { tableros: tableros.length, leidos: aLeer.length - fallidos.length, sinCambios: tableros.length - aLeer.length, quitados: quitar.length, fallidos, milisegundos: Date.now() - t0 };
}
