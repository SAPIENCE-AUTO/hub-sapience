// Copiado tal cual de streamvault/src/lib/speakerColors.ts (mismo criterio:
// determinista por orden de primera aparición, mismos tokens --chart-N que
// ya existen en index.css) — no hay razón para inventar una paleta distinta.
export const SPEAKER_COLORS = [
  'hsl(var(--chart-2))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-3))',
];

export function buildSpeakerColorMap(utterances: { speaker: string }[]): Record<string, string> {
  const speakers = Array.from(new Set(utterances.map(u => u.speaker)));
  const colorMap: Record<string, string> = {};
  speakers.forEach((s, i) => { colorMap[s] = SPEAKER_COLORS[i % SPEAKER_COLORS.length]; });
  return colorMap;
}
