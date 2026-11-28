// Búsqueda en las listas de Pagos de management (personas y deals) para poder escribir en vez de recorrer la lista completa (Sergio, 2026-11-28: «aquí en donde
// puedo elegir persona, déjame buscar también… y también en los deals»). Sin importar acentos ni mayúsculas, con TODAS las palabras escritas (en cualquier orden) y,
// primero, lo que tiene una palabra que EMPIEZA con lo escrito («lara» pone antes a «Claudio Laracuente» que a «Aguilara»). Lógica pura, sin pantalla.

export interface OpcionBuscable {
  valor: string;
  /** Lo que se ve en la lista. */
  texto: string;
  /** Más texto donde también se busca y que se ve aparte, atenuado (el departamento de una persona, el cliente de un deal). */
  extra?: string;
  /** Se ve pero no se puede elegir (una persona que ya está en otro renglón). */
  deshabilitada?: boolean;
}

/** Sin acentos ni mayúsculas, con los espacios en uno solo y sin los de los extremos. La ñ queda como n: aquí solo sirve para encontrar, no para distinguir. */
export const normalizarBusqueda = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Las opciones que traen todas las palabras escritas en su texto o su extra. Primero las que tienen una palabra que empieza con CADA palabra escrita, y luego el
 * resto de las que coinciden (cada grupo en su orden original). Sin texto salen todas en su orden. `total` es cuántas coinciden aunque solo se devuelvan `limite`.
 */
export function filtrarOpciones<T extends OpcionBuscable>(opciones: T[], texto: string, limite = Number.POSITIVE_INFINITY): { items: T[]; total: number } {
  const palabras = normalizarBusqueda(texto).split(' ').filter(Boolean);
  if (palabras.length === 0) return { items: opciones.slice(0, limite), total: opciones.length };

  const primeras: T[] = [];
  const resto: T[] = [];
  for (const o of opciones) {
    const pajar = normalizarBusqueda(`${o.texto} ${o.extra ?? ''}`);
    if (!palabras.every((p) => pajar.includes(p))) continue;
    const suyas = pajar.split(' ');
    (palabras.every((p) => suyas.some((w) => w.startsWith(p))) ? primeras : resto).push(o);
  }
  const todos = [...primeras, ...resto];
  return { items: todos.slice(0, limite), total: todos.length };
}
