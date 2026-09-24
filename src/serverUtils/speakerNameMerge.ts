import type { RecallSpeakerTimelineSegment } from './recallClient';

export interface Utterance {
  speaker: string;
  text: string;
  start: number; // ms, AssemblyAI
  end: number; // ms, AssemblyAI
}

/**
 * Reemplaza las etiquetas genéricas de AssemblyAI ("Speaker A/B") con los
 * nombres reales que Recall ya conoce por Teams — sin cambiar de motor de
 * transcripción. Por cada etiqueta de AssemblyAI, vota por el nombre real
 * con más segundos de traslape contra el speaker_timeline de Recall (no
 * solo el primer traslape) — así una sola utterance ruidosa no le cambia el
 * nombre a un speaker que ya se identificó bien en el resto de la junta.
 * Los `start`/`end` de AssemblyAI vienen en MILISEGUNDOS; los de Recall en
 * SEGUNDOS relativos al arranque de la grabación — mismo punto de partida
 * (mismo download_url para ambos), por eso son directamente comparables una
 * vez convertidos.
 */
export function mergeSpeakerNames(
  utterances: Utterance[],
  timeline: RecallSpeakerTimelineSegment[] | undefined,
): Utterance[] {
  if (!timeline?.length || !utterances.length) return utterances;

  const overlapByLabel = new Map<string, Map<string, number>>();
  for (const u of utterances) {
    const uStart = u.start / 1000;
    const uEnd = u.end / 1000;
    for (const seg of timeline) {
      const name = seg.participant?.name;
      // end_timestamp puede venir null en datos reales — el último segmento
      // de un participante que seguía "hablando" cuando el bot salió de la
      // junta, sin marca de fin formal. Sin dato, no hay con qué calcular
      // traslape, así que se descarta ese segmento en vez de tronar.
      if (!name || !seg.start_timestamp || !seg.end_timestamp) continue;
      const overlap = Math.min(uEnd, seg.end_timestamp.relative) - Math.max(uStart, seg.start_timestamp.relative);
      if (overlap <= 0) continue;
      const byName = overlapByLabel.get(u.speaker) ?? new Map<string, number>();
      byName.set(name, (byName.get(name) ?? 0) + overlap);
      overlapByLabel.set(u.speaker, byName);
    }
  }

  const nameByLabel = new Map<string, string>();
  for (const [label, byName] of overlapByLabel) {
    let bestName: string | undefined;
    let bestScore = 0;
    for (const [name, score] of byName) {
      if (score > bestScore) {
        bestName = name;
        bestScore = score;
      }
    }
    if (bestName) nameByLabel.set(label, bestName);
  }
  if (nameByLabel.size === 0) return utterances;

  return utterances.map(u => ({ ...u, speaker: nameByLabel.get(u.speaker) ?? u.speaker }));
}
