// Rejilla del tablero: 12 columnas y filas de alto fijo. Funciones puras para mover y estirar un bloque y acomodar los demás: quien se mueve tiene prioridad, lo que
// choca con él se empuja hacia abajo y todo se compacta hacia arriba (sin huecos), como en los tableros de Monday.
export const COLUMNAS = 12;
export const MIN_W = 2;
export const MIN_H = 2;
/** Topes para que un valor absurdo (1e999, 1e9) de una vista guardada no deje la página dando vueltas; la pantalla nunca los alcanza. */
export const MAX_FILAS = 400;
export const MAX_BLOQUES = 100;
const numero = (n: unknown, defecto: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : defecto);

export interface Pos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Colocable {
  id: string;
  pos: Pos;
}

export const choca = (a: Pos, b: Pos): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Acomoda cada bloque, de arriba abajo y de izquierda a derecha, en el lugar más alto donde no choque con los ya colocados. */
function gravedad<T extends Colocable>(items: T[], fijos: T[] = []): T[] {
  const colocados: T[] = [...fijos];
  const orden = [...items].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  for (const it of orden) {
    let y = 0;
    while (colocados.some(c => choca({ ...it.pos, y }, c.pos))) y++;
    colocados.push({ ...it, pos: { ...it.pos, y } });
  }
  return colocados;
}

/**
 * Quita los huecos de arriba hacia abajo. Con `prioritarioId`, ese bloque se queda donde se le puso (sube solo lo que le quede libre arriba) y los demás
 * se acomodan alrededor: lo que estorba se empuja hacia abajo.
 */
export function compactar<T extends Colocable>(items: T[], prioritarioId?: string): T[] {
  let resultado: T[];
  const mov = prioritarioId ? items.find(i => i.id === prioritarioId) : undefined;
  if (mov) {
    const resto = gravedad(items.filter(i => i.id !== mov.id), [mov]).filter(i => i.id !== mov.id);
    let y = mov.pos.y;
    while (y > 0 && !resto.some(c => choca({ ...mov.pos, y: y - 1 }, c.pos))) y--;
    resultado = gravedad([...resto, { ...mov, pos: { ...mov.pos, y } }]);
  } else {
    resultado = gravedad(items);
  }
  const porId = new Map(resultado.map(i => [i.id, i]));
  return items.map(i => porId.get(i.id) as T);
}

const entre = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Pone el bloque en (x, y) dentro de la rejilla y acomoda los demás. */
export function mover<T extends Colocable>(items: T[], id: string, x: number, y: number): T[] {
  const mov = items.find(i => i.id === id);
  if (!mov) return items;
  const pos: Pos = { ...mov.pos, x: entre(Math.round(numero(x, mov.pos.x)), 0, COLUMNAS - mov.pos.w), y: entre(Math.round(numero(y, mov.pos.y)), 0, MAX_FILAS) };
  return compactar(items.map(i => (i.id === id ? { ...i, pos } : i)), id);
}

/** Cambia el tamaño del bloque (sin salirse de la rejilla ni pasar del mínimo) y acomoda los demás. */
export function redimensionar<T extends Colocable>(items: T[], id: string, w: number, h: number, minimo = { w: MIN_W, h: MIN_H }): T[] {
  const mov = items.find(i => i.id === id);
  if (!mov) return items;
  // Si el mínimo no cabe a la derecha, el bloque se recorre a la izquierda en lugar de salirse de las 12 columnas.
  const x = Math.min(mov.pos.x, COLUMNAS - minimo.w);
  const pos: Pos = {
    ...mov.pos,
    x,
    w: entre(Math.round(numero(w, mov.pos.w)), minimo.w, COLUMNAS - x),
    h: entre(Math.round(numero(h, mov.pos.h)), minimo.h, MAX_FILAS),
  };
  return compactar(items.map(i => (i.id === id ? { ...i, pos } : i)), id);
}

/** Lugar para un bloque nuevo: al final, a todo lo ancho que se pida. */
export function posNueva(items: Colocable[], w: number, h: number): Pos {
  const y = items.reduce((m, i) => Math.max(m, i.pos.y + i.pos.h), 0);
  return { x: 0, y, w: Math.min(w, COLUMNAS), h };
}

/** Deja las posiciones dentro de la rejilla (números enteros, tamaños mínimos) y sin huecos ni empalmes; para lo que viene guardado. */
export function normalizar<T extends Colocable>(items: T[]): T[] {
  const limpios = items.map(i => {
    const w = entre(Math.round(numero(Number(i.pos.w), MIN_W) || MIN_W), MIN_W, COLUMNAS);
    const x = entre(Math.round(numero(Number(i.pos.x), 0)), 0, COLUMNAS - w);
    const y = entre(Math.round(numero(Number(i.pos.y), 0)), 0, MAX_FILAS);
    const h = entre(Math.round(numero(Number(i.pos.h), MIN_H) || MIN_H), MIN_H, MAX_FILAS);
    return { ...i, pos: { x, y, w, h } };
  });
  return compactar(limpios);
}

export const alturaTotal = (items: Colocable[]): number => items.reduce((m, i) => Math.max(m, i.pos.y + i.pos.h), 0);
