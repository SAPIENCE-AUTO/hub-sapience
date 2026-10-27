// Orden y búsqueda de los deals que se ofrecen para vincular un proyecto (DealPicker): alfabético en español, sin importar acentos ni mayúsculas.

export interface DealOpcion {
  id: string;
  dealName?: string | null;
  client?: string | null;
  phase?: string | null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nombre = (d: DealOpcion) => (d.dealName ?? '').trim();

/** Alfabético en español: «BTS» antes que «BTS 2» y los números se leen como números («Fase 2» antes que «Fase 10»). */
export const ordenarDeals = <T extends DealOpcion>(deals: T[]): T[] =>
  [...deals].sort((a, b) => nombre(a).localeCompare(nombre(b), 'es', { sensitivity: 'base', numeric: true }));

/**
 * Los deals que traen todas las palabras escritas en el nombre o el cliente; primero los que empiezan con lo escrito.
 * Sin texto salen todos en orden alfabético. `total` es cuántos coinciden aunque solo se devuelvan `limite`.
 */
export function buscarDeals<T extends DealOpcion>(deals: T[], texto: string, limite = 100): { items: T[]; total: number } {
  const q = norm(texto).trim();
  const palabras = q.split(/\s+/).filter(Boolean);
  const ordenados = ordenarDeals(deals);
  const coinciden = palabras.length === 0
    ? ordenados
    : ordenados.filter((d) => {
        const pajar = norm(`${nombre(d)} ${d.client ?? ''}`);
        return palabras.every((p) => pajar.includes(p));
      });
  const empiezan = q ? coinciden.filter((d) => norm(nombre(d)).startsWith(q)) : [];
  const resto = q ? coinciden.filter((d) => !norm(nombre(d)).startsWith(q)) : coinciden;
  const todos = [...empiezan, ...resto];
  return { items: todos.slice(0, limite), total: todos.length };
}
