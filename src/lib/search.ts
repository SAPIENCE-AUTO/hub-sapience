// Búsqueda sin acentos ni mayúsculas ("jose" encuentra "José"); cada palabra
// del texto buscado debe aparecer en alguno de los campos.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchesQuery(query: string, ...fields: (string | undefined | null)[]): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return words.every(w => hay.includes(w));
}
