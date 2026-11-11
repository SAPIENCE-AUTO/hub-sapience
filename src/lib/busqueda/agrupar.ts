import { partirPiezas, plantillaDe } from './texto';

// Qué hace el buscador con lo que encuentra: junta las preguntas que son la misma en varios tableros («Levité (Priorización marcas)» y «Takis (Priorización marcas)» son la misma pregunta con otra marca) y
// dice, de cada grupo, en qué tableros está y cuántas filas dieron cada respuesta. Todo es puro: la búsqueda en la base (serverUtils/busqueda/buscar.ts) solo trae las filas y esto las ordena.
//
// Hay dos formas de encontrar a alguien:
// - «columna»: el término está en el NOMBRE de la pregunta («Levité (Priorización marcas)», «¿Cuándo fue la última vez que compraste Levité?»): lo que cuenta es la respuesta que dio a esa pregunta
//   («Es mi top / favorita», «No me gusta / no la compro»…).
// - «respuesta»: el término está en lo que RESPONDIÓ («Corona, Modelo, Victoria» a «Ranking marcas de cerveza»): lo que cuenta es mencionarlo, y en una lista, si fue la primera.

export interface TableroInfo { tableroId: string; proyecto: string | null; tablero: string; cliente: string | null; fechaInicio: string | null }
export interface ColumnaHallada extends TableroInfo {
  columnaId: string;
  nombre: string;
  nombreNorm: string;
  respondieron: number;
  modo: 'valores' | 'lista';
}
export interface PiezaHallada { columnaId: string; pieza: string; etiqueta: string; filas: number; primero: number | null }

/** `valor` es el texto normalizado (con el que se busca y se elige); `etiqueta`, cómo se escribía (con acentos) para mostrarlo. */
export interface ValorDeItem { valor: string; etiqueta: string; filas: number; primero: number | null }
export interface ItemDeGrupo extends TableroInfo {
  columnaId: string;
  /** El nombre de la pregunta tal como está en este tablero. */
  columna: string;
  respondieron: number;
  /** Lo que cuenta en este tablero: todas las respuestas de la pregunta (grupo «columna») o solo las que mencionan el término (grupo «respuesta»). */
  valores: ValorDeItem[];
  /** Para ordenar: en «columna», las filas que respondieron; en «respuesta», las que mencionan el término (suma de las piezas que lo contienen: una fila que menciona dos piezas cuenta dos veces). */
  filas: number;
}
export interface GrupoHallado {
  clave: string;
  donde: 'columna' | 'respuesta';
  /** El nombre de una de las preguntas del grupo, para mostrar cómo se preguntó. */
  ejemplo: string;
  tableros: number;
  filas: number;
  /** Las respuestas del grupo sumadas de todos los tableros, de la que más filas tiene a la que menos. */
  valores: Array<{ valor: string; etiqueta: string; filas: number; tableros: number }>;
  items: ItemDeGrupo[];
}

export const MAX_GRUPOS = 40;
export const MAX_ITEMS_POR_GRUPO = 120;
/** Cuántas respuestas se muestran por tablero (las que más filas tienen); los totales del grupo cuentan todas. */
export const MAX_VALORES_POR_ITEM = 20;

const sumar = (cuentas: Iterable<ValorDeItem & { tableroId: string }>) => {
  const por = new Map<string, { etiqueta: string; filas: number; tableros: Set<string> }>();
  for (const v of cuentas) {
    const x = por.get(v.valor) ?? { etiqueta: v.etiqueta || v.valor, filas: 0, tableros: new Set<string>() };
    x.filas += v.filas; x.tableros.add(v.tableroId);
    por.set(v.valor, x);
  }
  return [...por].map(([valor, x]) => ({ valor, etiqueta: x.etiqueta, filas: x.filas, tableros: x.tableros.size })).sort((a, b) => b.filas - a.filas || a.valor.localeCompare(b.valor));
};

/**
 * Junta lo hallado en grupos. `porNombre`: las preguntas cuyo nombre lleva el término, con `piezasDeEllas` (todas sus respuestas). `porRespuesta`: las respuestas que mencionan el término, de preguntas
 * cuyo nombre no lo lleva (cada una con los datos de su pregunta y su tablero).
 */
export function agruparHallazgos(
  termino: string,
  porNombre: ColumnaHallada[],
  piezasDeEllas: PiezaHallada[],
  porRespuesta: Array<PiezaHallada & ColumnaHallada>,
): GrupoHallado[] {
  const grupos = new Map<string, { donde: 'columna' | 'respuesta'; ejemplo: string; items: ItemDeGrupo[] }>();
  const agregar = (clave: string, donde: 'columna' | 'respuesta', ejemplo: string, item: ItemDeGrupo) => {
    const id = `${donde}|${clave}`;
    const g = grupos.get(id) ?? { donde, ejemplo, items: [] };
    g.items.push(item);
    grupos.set(id, g);
  };

  const piezasDe = new Map<string, PiezaHallada[]>();
  for (const p of piezasDeEllas) { const l = piezasDe.get(p.columnaId); if (l) l.push(p); else piezasDe.set(p.columnaId, [p]); }
  for (const c of porNombre) {
    const valores = (piezasDe.get(c.columnaId) ?? []).map((p) => ({ valor: p.pieza, etiqueta: p.etiqueta, filas: p.filas, primero: p.primero })).sort((a, b) => b.filas - a.filas || a.valor.localeCompare(b.valor));
    agregar(plantillaDe(c.nombreNorm, termino), 'columna', c.nombre, {
      tableroId: c.tableroId, proyecto: c.proyecto, tablero: c.tablero, cliente: c.cliente, fechaInicio: c.fechaInicio,
      columnaId: c.columnaId, columna: c.nombre, respondieron: c.respondieron, valores, filas: c.respondieron,
    });
  }

  // Las respuestas que mencionan el término, juntas por pregunta (y tablero).
  const porColumna = new Map<string, { c: ColumnaHallada; valores: ValorDeItem[] }>();
  for (const p of porRespuesta) {
    const x = porColumna.get(p.columnaId) ?? { c: p, valores: [] };
    x.valores.push({ valor: p.pieza, etiqueta: p.etiqueta, filas: p.filas, primero: p.primero });
    porColumna.set(p.columnaId, x);
  }
  for (const { c, valores } of porColumna.values()) {
    valores.sort((a, b) => b.filas - a.filas || a.valor.localeCompare(b.valor));
    agregar(c.nombreNorm, 'respuesta', c.nombre, {
      tableroId: c.tableroId, proyecto: c.proyecto, tablero: c.tablero, cliente: c.cliente, fechaInicio: c.fechaInicio,
      columnaId: c.columnaId, columna: c.nombre, respondieron: c.respondieron, valores, filas: valores.reduce((s, v) => s + v.filas, 0),
    });
  }

  const lista: GrupoHallado[] = [];
  for (const [id, g] of grupos) {
    const items = [...g.items].sort((a, b) => b.filas - a.filas || (b.fechaInicio ?? '').localeCompare(a.fechaInicio ?? '') || a.tablero.localeCompare(b.tablero));
    lista.push({
      clave: id.slice(id.indexOf('|') + 1), donde: g.donde, ejemplo: g.ejemplo,
      tableros: new Set(items.map((i) => i.tableroId)).size,
      filas: items.reduce((s, i) => s + i.filas, 0),
      valores: sumar(items.flatMap((i) => i.valores.map((v) => ({ ...v, tableroId: i.tableroId })))),
      items: items.slice(0, MAX_ITEMS_POR_GRUPO).map((i) => ({ ...i, valores: i.valores.slice(0, MAX_VALORES_POR_ITEM) })),
    });
  }
  return lista.sort((a, b) => b.filas - a.filas || b.tableros - a.tableros || a.clave.localeCompare(b.clave)).slice(0, MAX_GRUPOS);
}

/** Si la pieza o el texto de una respuesta pone el término como PRIMERA opción de su lista (en un ranking, la favorita). En las listas partidas ya viene contado; en las de texto entero se mira el principio. */
export function esPrimeraOpcion(valor: ValorDeItem, termino: string): number {
  if (valor.primero != null) return valor.primero;
  return (partirPiezas(valor.valor)[0] ?? '').includes(termino) ? valor.filas : 0;
}

/**
 * Cuántas filas de un tablero cumplen lo que la persona eligió. En un grupo «columna» (el término está en el nombre de la pregunta): las filas que respondieron alguna de las opciones elegidas, o todas
 * las que respondieron si no eligió ninguna. En un grupo «respuesta» (el término está en lo que contestaron): las que lo mencionan, o solo las que lo ponen primero.
 */
export function filasQueCumplen(donde: 'columna' | 'respuesta', item: Pick<ItemDeGrupo, 'respondieron' | 'valores'>, elegidas: ReadonlySet<string>, soloPrimero: boolean, termino: string): number {
  if (donde === 'columna') {
    if (elegidas.size === 0) return item.respondieron;
    return item.valores.filter((v) => elegidas.has(v.valor)).reduce((s, v) => s + v.filas, 0);
  }
  return item.valores.reduce((s, v) => s + (soloPrimero ? esPrimeraOpcion(v, termino) : v.filas), 0);
}
