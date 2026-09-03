/**
 * Clasifica una idea de Swipe cruzando % de aprobación con qué tan rápido
 * se decidió (ms_decision) — el insight que el spec original pedía y que
 * el voto solo no da: alta aprobación + decisión rápida es consenso
 * genuino; alta aprobación + decisión lenta es una idea que convence pero
 * cuesta, vale la pena discutirla aunque pase el corte.
 *
 * El umbral de "rápido/lento" es la mediana de tiempos DENTRO del mismo
 * capítulo (no un número fijo en ms) — el ritmo de un workshop varía
 * mucho de un grupo a otro, comparar contra el propio capítulo es lo que
 * tiene sentido.
 */
export type SwipeQuadrante = 'consenso_rapido' | 'convence_cuesta' | 'rechazo_inmediato' | 'duda_genuina';

export function medianaDe(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function clasificarQuadrante(
  pctPotencial: number,
  avgMsDecision: number | undefined,
  medianaMs: number,
): SwipeQuadrante | undefined {
  if (avgMsDecision === undefined) return undefined;
  const rapido = avgMsDecision <= medianaMs;
  const apoyada = pctPotencial >= 50;
  if (apoyada && rapido) return 'consenso_rapido';
  if (apoyada && !rapido) return 'convence_cuesta';
  if (!apoyada && rapido) return 'rechazo_inmediato';
  return 'duda_genuina';
}
