import { useEffect, useMemo, useRef } from 'react';
import { buildSpeakerColorMap } from './speakerColors';

export interface Utterance { speaker: string; text: string; start: number; end: number }

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Versión a nivel de turno (no de palabra) de SyncedTranscript.tsx de Sharpli
// — mismo look (timecode clickeable, speaker en negritas con color propio,
// fila activa resaltada y con auto-scroll) pero sin resaltado por palabra,
// búsqueda ni creación de clips: ninguna de las tres aplica a una minuta de
// junta. "Mismos features, layout similar" donde tiene sentido, no una copia
// mecánica de todo lo que trae la página de streaming.
export default function MeetingSyncedTranscript({ utterances, currentTime, onSeek }: {
  utterances: Utterance[];
  currentTime: number;
  onSeek?: (seconds: number) => void;
}) {
  const activeIndex = utterances.findIndex(u => currentTime >= u.start / 1000 && currentTime < u.end / 1000);
  const colorMap = useMemo(() => buildSpeakerColorMap(utterances), [utterances]);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="space-y-0.5 max-h-[calc(90vh-16rem)] overflow-y-auto pr-1">
      {utterances.map((u, i) => {
        const isActive = i === activeIndex;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            className={`flex gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
              isActive ? 'bg-primary/10 border border-primary/25 shadow-sm' : 'hover:bg-muted/50 border border-transparent'
            }`}
            onClick={() => onSeek?.(u.start / 1000)}
          >
            <span className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5 font-mono tabular-nums">
              {formatTime(u.start)}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold mr-2" style={{ color: colorMap[u.speaker] }}>
                Speaker {u.speaker}
              </span>
              <span className={`text-sm leading-relaxed ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {u.text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
