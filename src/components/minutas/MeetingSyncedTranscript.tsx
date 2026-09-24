import { useEffect, useMemo, useRef } from 'react';
import { buildSpeakerColorMap } from './speakerColors';

export interface Utterance { speaker: string; text: string; start: number; end: number }
export interface WordTimestamp { text: string; start: number; end: number }
type WordToken = { text: string; start: number; end: number };

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Nombre a mostrar para un speaker — igual que formatTranscript.ts
// (assemblyAiClient.ts): si mergeSpeakerNames.ts ya lo reemplazó por el
// nombre real de Recall, se usa tal cual; si sigue siendo la etiqueta
// genérica de AssemblyAI ("A", "B"), se antepone "Speaker ".
function speakerLabel(speaker: string) {
  return /^[A-Z]$/.test(speaker) ? `Speaker ${speaker}` : speaker;
}

// Si no hay timestamps reales por palabra (transcripciones de antes de que
// se guardaran, o si AssemblyAI no las regresó), se reparten las palabras
// del turno en partes iguales sobre su duración — mismo fallback que
// interpolateWords() en SyncedTranscript.tsx de Sharpli.
function interpolateWords(u: Utterance): WordToken[] {
  const rawWords = u.text.match(/\S+/g) ?? [];
  if (!rawWords.length) return [];
  const duration = u.end - u.start;
  return rawWords.map((word, wi) => ({
    text: word,
    start: u.start + Math.round((wi / rawWords.length) * duration),
    end: u.start + Math.round(((wi + 1) / rawWords.length) * duration),
  }));
}

// Puerto de SyncedTranscript.tsx de Sharpli: resaltado de la palabra activa
// durante el playback (basado en currentTime, no en un timer aparte) y seek
// exacto al dar clic en una palabra — mismos nombres de campo (start/end en
// ms) y misma lógica de traslape. Sin búsqueda ni creación de clips: ninguna
// de las dos aplica a una minuta de junta.
export default function MeetingSyncedTranscript({ utterances, words, currentTime, onSeek }: {
  utterances: Utterance[];
  words?: WordTimestamp[];
  currentTime: number;
  onSeek?: (seconds: number) => void;
}) {
  const activeIndex = utterances.findIndex(u => currentTime >= u.start / 1000 && currentTime < u.end / 1000);
  const colorMap = useMemo(() => buildSpeakerColorMap(utterances), [utterances]);
  const activeRef = useRef<HTMLDivElement>(null);
  const currentTimeMs = currentTime * 1000;

  // Timestamps reales por palabra, ubicados dentro de la utterance a la que
  // pertenecen por rango de tiempo (no por texto) — igual que wordMap en
  // SyncedTranscript.tsx cuando hay `words`; sin ellos, cae al fallback
  // interpolado.
  const wordMap = useMemo(() => {
    if (words?.length) {
      return utterances.map(u => {
        const uWords = words.filter(w => w.start >= u.start && w.start < u.end);
        return uWords.length ? uWords : interpolateWords(u);
      });
    }
    return utterances.map(u => interpolateWords(u));
  }, [utterances, words]);

  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="space-y-0.5 max-h-[calc(90vh-16rem)] overflow-y-auto pr-1">
      {utterances.map((u, i) => {
        const isActive = i === activeIndex;
        const ws = wordMap[i];
        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            className={`flex gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-primary/10 border border-primary/25 shadow-sm' : 'hover:bg-muted/50 border border-transparent'
            }`}
          >
            <span
              className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5 font-mono tabular-nums cursor-pointer hover:text-foreground"
              onClick={() => onSeek?.(u.start / 1000)}
            >
              {formatTime(u.start)}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold mr-2" style={{ color: colorMap[u.speaker] }}>
                {speakerLabel(u.speaker)}
              </span>
              <span className={`text-sm leading-relaxed ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {ws.map((word, wi) => {
                  const isActiveWord = isActive && currentTimeMs >= word.start && currentTimeMs < word.end;
                  return (
                    <span
                      key={wi}
                      onClick={(e) => { e.stopPropagation(); onSeek?.(word.start / 1000); }}
                      className={`cursor-pointer ${isActiveWord ? 'text-primary font-semibold' : ''}`}
                    >
                      {word.text}{' '}
                    </span>
                  );
                })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
