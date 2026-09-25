// "necesito que sea infalible" (Sergio, tras el bug real de "Ajustes LRP":
// video listo, transcripción nunca arrancó porque la llamada a AssemblyAI
// en el webhook de Recall truena una sola vez y solo se loguea, sin
// reintentar). Nada que dependa de dos APIs externas por red puede ser
// 100% infalible, pero la mayoría de esas fallas son transitorias (un 5xx,
// un timeout) — reintentar con backoff antes de rendirse elimina la
// inmensa mayoría sin intervención humana.
export async function withRetries<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [2000, 5000, 10000],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delaysMs.length) await new Promise(r => setTimeout(r, delaysMs[attempt]));
    }
  }
  throw lastErr;
}
