import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, Play, Square, SkipForward } from 'lucide-react';
import type { Utterance } from './MeetingSyncedTranscript';
import { buildSpeakerColorMap } from './speakerColors';

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Mulberry32 seeded PRNG [0, 1)
function seededRand(seed: number): number {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const NUM_BARS = 380;

// Pre-compute smoothed heights once (seeded → deterministic)
const SMOOTHED_HEIGHTS: number[] = (() => {
  const raw = Array.from({ length: NUM_BARS }, (_, i) => seededRand(i * 6271 + 99));
  const W = 6;
  return raw.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = i - W; j <= i + W; j++) {
      if (j >= 0 && j < NUM_BARS) { sum += raw[j]; count++; }
    }
    return sum / count;
  });
})();

// ─── Waveform SVG sub-component ───────────────────────────────────────────────
interface WaveformProps {
  utterances: Utterance[];
  duration: number;
  currentTime: number;
  onSeek: (s: number) => void;
  colorMap: Record<string, string>;
  height: number;
  filterSpeaker?: string; // if set, only shows that speaker's utterances
}

function Waveform({ utterances, duration, currentTime, onSeek, colorMap, height, filterSpeaker }: WaveformProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const bars = useMemo(() => {
    const source = filterSpeaker
      ? utterances.filter(u => u.speaker === filterSpeaker)
      : utterances;
    return SMOOTHED_HEIGHTS.map((h, i) => {
      const t = (i / NUM_BARS) * duration;
      const utt = source.find(u => t >= u.start / 1000 && t <= u.end / 1000);
      return {
        speaking: !!utt,
        speaker: utt?.speaker ?? null,
        // silence: flat tiny stub; speech: dynamic height
        ratio: utt ? Math.max(0.18, h * 0.85 + 0.15) : 0.05,
      };
    });
  }, [utterances, duration, filterSpeaker]);

  const playheadPct = Math.min((currentTime / duration) * 100, 100);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  };

  // Gap between bars: we render bars at every integer slot; bar width ≈ 1.5px
  const barW = 1.5;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={height}
      onClick={handleClick}
      className="cursor-pointer overflow-visible"
      style={{ display: 'block' }}
    >
      {bars.map((bar, i) => {
        const xPct = (i / NUM_BARS) * 100;
        const barH = Math.max(2, bar.ratio * height);
        const y = (height - barH) / 2;
        const isPast = xPct < playheadPct;

        const fill = bar.speaker
          ? colorMap[bar.speaker]
          : 'hsl(var(--muted-foreground))';
        const opacity = bar.speaking
          ? (isPast ? 0.95 : 0.45)
          : (isPast ? 0.2 : 0.1);

        return (
          <rect
            key={i}
            x={`${xPct}%`}
            y={y}
            width={barW}
            height={barH}
            style={{ fill }}
            opacity={opacity}
            rx={0.75}
          />
        );
      })}

      {/* Playhead */}
      <rect
        x={`${playheadPct}%`}
        y={0}
        width={2}
        height={height}
        style={{ fill: 'hsl(var(--foreground))' }}
        opacity={0.75}
        rx={1}
      />
    </svg>
  );
}

// Adaptado tal cual de streamvault/src/components/SpeakerTimeline.tsx — "en
// qué parte de la grabación vamos" (Sergio): waveform con el playhead, el
// speaker que está hablando ahora mismo y el timestamp, todo sincronizado
// con el video. videoRef acá apunta al <mux-player> (mismo contrato que un
// <video>: .currentTime settable, .play()/.pause()), no a un <video> plano.
export default function MeetingSpeakerTimeline({
  utterances, currentTime, duration, onSeek, videoRef,
}: {
  utterances: Utterance[];
  currentTime: number;
  duration: number;
  onSeek: (s: number) => void;
  videoRef: React.RefObject<any>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [playingSpeaker, setPlayingSpeaker] = useState<string | null>(null);
  const [speakerQueue, setSpeakerQueue] = useState<{ start: number; end: number }[]>([]);
  const queueIndexRef = useRef(0);

  if (!utterances.length || !duration) return null;

  const speakers = Array.from(new Set(utterances.map(u => u.speaker)));
  const colorMap = buildSpeakerColorMap(utterances);
  // Si mergeSpeakerNames.ts ya reemplazó la etiqueta genérica de AssemblyAI
  // ("A", "B") por el nombre real de Recall, se usa tal cual — mismo
  // criterio que MeetingSyncedTranscript.tsx / formatTranscript.ts.
  const speakerLabel = (s: string) => (/^[A-Z]$/.test(s) ? `Speaker ${s}` : s);

  // Find current speaker
  let activeSpeaker = '';
  for (const u of utterances) {
    if (currentTime >= u.start / 1000 && currentTime <= u.end / 1000) {
      activeSpeaker = u.speaker; break;
    }
  }

  // Advance queue when current utterance ends
  useEffect(() => {
    if (!playingSpeaker || !speakerQueue.length) return;
    const idx = queueIndexRef.current;
    const current = speakerQueue[idx];
    if (!current) return;
    if (currentTime >= current.end / 1000 - 0.15) {
      const next = speakerQueue[idx + 1];
      if (next) {
        queueIndexRef.current = idx + 1;
        videoRef.current!.currentTime = next.start / 1000;
        videoRef.current!.play();
      } else {
        setPlayingSpeaker(null);
        setSpeakerQueue([]);
        queueIndexRef.current = 0;
      }
    }
  }, [currentTime, playingSpeaker, speakerQueue]);

  useEffect(() => {
    if (!expanded) {
      setPlayingSpeaker(null);
      setSpeakerQueue([]);
      queueIndexRef.current = 0;
    }
  }, [expanded]);

  const handlePlay = (speaker: string) => {
    if (playingSpeaker === speaker) {
      setPlayingSpeaker(null); setSpeakerQueue([]); queueIndexRef.current = 0;
      videoRef.current?.pause();
      return;
    }
    const queue = utterances.filter(u => u.speaker === speaker).sort((a, b) => a.start - b.start);
    setSpeakerQueue(queue); queueIndexRef.current = 0; setPlayingSpeaker(speaker);
    if (videoRef.current) { videoRef.current.currentTime = queue[0].start / 1000; videoRef.current.play(); }
  };

  const handleSkipNext = (speaker: string) => {
    const next = utterances
      .filter(u => u.speaker === speaker && u.start / 1000 > currentTime + 0.5)
      .sort((a, b) => a.start - b.start)[0];
    if (next) onSeek(next.start / 1000);
  };

  const hasNextUtterance = (speaker: string) =>
    utterances.some(u => u.speaker === speaker && u.start / 1000 > currentTime + 0.5);

  const SpeakerControls = ({ speaker, color }: { speaker: string; color: string }) => {
    const isPlaying = playingSpeaker === speaker;
    const canSkip = hasNextUtterance(speaker);
    return (
      <>
        <button onClick={() => handlePlay(speaker)} className="shrink-0 transition-colors"
          title={isPlaying ? 'Detener' : `Reproducir ${speakerLabel(speaker)}`}>
          {isPlaying
            ? <Square className="h-3 w-3" style={{ color }} />
            : <Play className="h-3 w-3 text-muted-foreground hover:text-foreground" />}
        </button>
        <button onClick={() => handleSkipNext(speaker)}
          disabled={!canSkip}
          className="shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Siguiente intervención">
          <SkipForward className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      </>
    );
  };

  // ── Collapsed view ──
  if (!expanded) {
    return (
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
              Timeline
            </span>
            {activeSpeaker && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: colorMap[activeSpeaker] }} />
                <p className="text-[11px] text-foreground font-medium truncate leading-none">
                  {speakerLabel(activeSpeaker)}
                </p>
                <span className="text-[10px] text-muted-foreground">· {formatTime(currentTime)}</span>
                <SpeakerControls speaker={activeSpeaker} color={colorMap[activeSpeaker]} />
              </>
            )}
          </div>
          <button onClick={() => setExpanded(true)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-1">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Full waveform — tall bars */}
        <div className="w-full rounded-lg overflow-hidden bg-muted/20" style={{ height: 40 }}>
          <Waveform
            utterances={utterances}
            duration={duration}
            currentTime={currentTime}
            onSeek={onSeek}
            colorMap={colorMap}
            height={40}
          />
        </div>

        {/* Speaker color legend */}
        <div className="flex items-center gap-2 flex-wrap">
          {speakers.map(s => (
            <div key={s} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colorMap[s] }} />
              <span className="text-[9px] text-muted-foreground truncate" style={{ maxWidth: 72 }}>
                {speakerLabel(s)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Expanded view — per-speaker waveforms ──
  return (
    <div className="w-full space-y-1">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Speakers
        </p>
        <button onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>

      {speakers.map(speaker => {
        const isPlaying = playingSpeaker === speaker;
        const isDimmed = playingSpeaker !== null && !isPlaying;
        return (
          <div key={speaker}
            className="flex items-center gap-1.5 transition-opacity duration-200"
            style={{ opacity: isDimmed ? 0.3 : 1 }}>

            {/* Name */}
            <p className="text-[10px] text-muted-foreground truncate shrink-0" style={{ width: 64 }}>
              {speakerLabel(speaker)}
            </p>

            {/* Controls */}
            <SpeakerControls speaker={speaker} color={colorMap[speaker]} />

            {/* Per-speaker waveform — compact */}
            <div className="relative flex-1 rounded overflow-hidden bg-muted/20" style={{ height: 22 }}>
              <Waveform
                utterances={utterances}
                duration={duration}
                currentTime={currentTime}
                onSeek={onSeek}
                colorMap={colorMap}
                height={22}
                filterSpeaker={speaker}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
