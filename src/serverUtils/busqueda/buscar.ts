import { agruparHallazgos, type ColumnaHallada, type GrupoHallado, type PiezaHallada } from '../../lib/busqueda/agrupar';
import { esTerminoValido, normalizarTexto } from '../../lib/busqueda/texto';
import type { Consulta } from './catalogo';

// Buscar en el catálogo (catalogo.ts): dónde se preguntó por una marca o una palabra y qué respondió la gente. No toca los tableros: solo lee las tablas del buscador, así que responde al instante.

/** Para usar un texto dentro de un LIKE sin que sus % o _ valgan como comodines. */
export const escaparLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Cuántas preguntas por nombre se traen como máximo (una palabra muy común, como «marca», llevaría miles). */
const MAX_COLUMNAS_POR_NOMBRE = 1500;
/** Cuántas respuestas que mencionan el término se traen como máximo. */
const MAX_PIEZAS_QUE_MENCIONAN = 6000;

const aColumna = (r: Record<string, any>): ColumnaHallada => ({
  tableroId: String(r.tablero_id), proyecto: (r.proyecto as string | null) ?? null, tablero: String(r.tablero ?? ''), cliente: (r.cliente as string | null) ?? null,
  fechaInicio: (r.fecha_inicio as string | null) ?? null, columnaId: String(r.columna), nombre: String(r.nombre), nombreNorm: String(r.nombre_norm),
  respondieron: Number(r.respondieron), modo: r.modo === 'lista' ? 'lista' : 'valores',
});

export interface ResultadoBusqueda {
  termino: string;
  grupos: GrupoHallado[];
  /** Hubo más preguntas o respuestas que las que se traen: hay que afinar el término. */
  recortado: boolean;
}

/** Dónde se preguntó por `termino` (en el nombre de la pregunta o en lo que respondieron), agrupado por cómo se preguntó. */
export async function buscarEnCatalogo(consulta: Consulta, terminoCrudo: string): Promise<ResultadoBusqueda> {
  const termino = normalizarTexto(terminoCrudo);
  if (!esTerminoValido(termino)) return { termino, grupos: [], recortado: false };
  const like = `%${escaparLike(termino)}%`;

  const { rows: nombres } = await consulta.query(
    `select c.id::text as columna, c.tablero_id, c.nombre, c.nombre_norm, c.respondieron, c.modo, t.proyecto, t.tablero, t.cliente, t.fecha_inicio::text as fecha_inicio
     from busqueda_columnas c join busqueda_tableros t on t.tablero_id = c.tablero_id
     where c.nombre_norm like $1 escape '\\' order by c.respondieron desc limit ${MAX_COLUMNAS_POR_NOMBRE + 1}`,
    [like],
  );
  const recortadoNombres = nombres.length > MAX_COLUMNAS_POR_NOMBRE;
  const porNombre = nombres.slice(0, MAX_COLUMNAS_POR_NOMBRE).map(aColumna);
  const ids = porNombre.map((c) => c.columnaId);

  const { rows: piezas } = ids.length
    ? await consulta.query(`select columna::text as columna, pieza, etiqueta, filas, primero from busqueda_piezas where columna = any($1::uuid[])`, [ids])
    : { rows: [] as Array<Record<string, any>> };
  const piezasDeEllas: PiezaHallada[] = piezas.map((p) => ({ columnaId: String(p.columna), pieza: String(p.pieza), etiqueta: String(p.etiqueta ?? p.pieza), filas: Number(p.filas), primero: p.primero == null ? null : Number(p.primero) }));

  const { rows: menciones } = await consulta.query(
    `select p.columna::text as columna, p.pieza, p.etiqueta, p.filas, p.primero, c.tablero_id, c.nombre, c.nombre_norm, c.respondieron, c.modo, t.proyecto, t.tablero, t.cliente, t.fecha_inicio::text as fecha_inicio
     from busqueda_piezas p join busqueda_columnas c on c.id = p.columna join busqueda_tableros t on t.tablero_id = c.tablero_id
     where p.pieza like $1 escape '\\' and not (c.nombre_norm like $1 escape '\\')
     order by p.filas desc limit ${MAX_PIEZAS_QUE_MENCIONAN + 1}`,
    [like],
  );
  const recortadoMenciones = menciones.length > MAX_PIEZAS_QUE_MENCIONAN;
  const porRespuesta = menciones.slice(0, MAX_PIEZAS_QUE_MENCIONAN).map((r) => ({
    ...aColumna(r), pieza: String(r.pieza), etiqueta: String(r.etiqueta ?? r.pieza), filas: Number(r.filas), primero: r.primero == null ? null : Number(r.primero),
  }));

  return { termino, grupos: agruparHallazgos(termino, porNombre, piezasDeEllas, porRespuesta), recortado: recortadoNombres || recortadoMenciones };
}

export interface EstadoCatalogo {
  existe: boolean;
  tableros: number;
  preguntas: number;
  respuestas: number;
  /** Cuándo se leyó el tablero que se leyó más recientemente. */
  actualizado: string | null;
}

/** Qué sabe el buscador: cuántos tableros, preguntas y respuestas y de cuándo es. Si las tablas no existen, lo dice sin fallar. */
export async function estadoDelCatalogo(consulta: Consulta): Promise<EstadoCatalogo> {
  try {
    const { rows: [t] } = await consulta.query(`select count(*)::int as tableros, max(leido)::text as actualizado, coalesce(sum(columnas), 0)::int as preguntas from busqueda_tableros`);
    const { rows: [p] } = await consulta.query(`select count(*)::int as respuestas from busqueda_piezas`);
    return { existe: true, tableros: Number(t.tableros), preguntas: Number(t.preguntas), respuestas: Number(p.respuestas), actualizado: (t.actualizado as string | null) ?? null };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === '42P01' || /relation "busqueda_\w+" does not exist/i.test(e.message ?? '')) return { existe: false, tableros: 0, preguntas: 0, respuestas: 0, actualizado: null };
    throw err;
  }
}
