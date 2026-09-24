import { useEffect, useRef, useState } from 'react';
import '@mux/mux-player';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Video } from 'lucide-react';
import MeetingSummaryPanel from './MeetingSummaryPanel';
import MeetingSyncedTranscript, { type Utterance } from './MeetingSyncedTranscript';

interface Acuerdo { texto: string; responsable?: string | null; hecho: boolean }
interface SummaryJson { resumen: string; acuerdos: Acuerdo[] }

export interface MeetingRecording {
  id: string;
  subject?: string;
  status?: string;
  meetingStart?: string;
  createdAt?: string;
  muxPlaybackId?: string;
  transcript?: string;
  transcriptData?: { utterances: Utterance[] };
  summaryJson?: SummaryJson;
}

type Tab = 'resumen' | 'transcripcion';

// Minutas / notetaker (sep 2026): mismo layout de StreamingDetailPage.tsx de
// Sharpli — video a la izquierda (sticky), mini-tabs debajo del video, panel
// de contenido a la derecha en una card con el mismo tratamiento visual
// (bg-card, border, rounded-xl, p-6). La transcripción sincroniza con el
// video igual que SyncedTranscript (clic en un turno = seek), a nivel de
// turno en vez de palabra — no hay creación de clips ni búsqueda en Minutas,
// así que ese detalle de Sharpli no aplica aquí.
export default function MeetingRecordingDetailDialog({ recording, open, onClose }: {
  recording: MeetingRecording | null;
  open: boolean;
  onClose: () => void;
}) {
  const [summaryJson, setSummaryJson] = useState<SummaryJson | undefined>(recording?.summaryJson);
  const [tab, setTab] = useState<Tab>('resumen');
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    setSummaryJson(recording?.summaryJson);
    setTab('resumen');
    setCurrentTime(0);
  }, [recording?.id]);

  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    const handler = () => setCurrentTime(el.currentTime ?? 0);
    el.addEventListener('timeupdate', handler);
    return () => el.removeEventListener('timeupdate', handler);
  }, [recording?.muxPlaybackId]);

  const handleSeek = (seconds: number) => {
    const el = playerRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play?.();
  };

  if (!recording) return null;

  const utterances = recording.transcriptData?.utterances ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{recording.subject || 'Minuta'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-[42%] md:sticky md:top-0 md:self-start shrink-0 flex flex-col gap-3">
              {recording.muxPlaybackId ? (
                <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black">
                  {/* @ts-expect-error -- web component de @mux/mux-player, sin tipos de React/JSX */}
                  <mux-player
                    ref={playerRef}
                    playback-id={recording.muxPlaybackId}
                    stream-type="on-demand"
                    controls
                    style={{ width: '100%', height: '100%', '--media-object-fit': 'contain' }}
                  />
                </div>
              ) : (
                <div className="aspect-video w-full rounded-xl border border-border bg-muted flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <Video className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Video aún no disponible</p>
                  </div>
                </div>
              )}
              <div className="flex items-end gap-0 border-b border-border">
                <button
                  onClick={() => setTab('resumen')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    tab === 'resumen' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Resumen
                </button>
                <button
                  onClick={() => setTab('transcripcion')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    tab === 'transcripcion' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Transcripción
                </button>
              </div>
            </div>

            <div className="w-full md:flex-1 min-w-0">
              <div className="bg-card border border-border rounded-xl p-6 min-h-[calc(92vh-10rem)]">
                {tab === 'resumen' && (
                  <MeetingSummaryPanel
                    meetingRecordingId={recording.id}
                    transcript={recording.transcript}
                    summaryJson={summaryJson}
                    onSummaryChange={setSummaryJson}
                  />
                )}
                {tab === 'transcripcion' && (
                  utterances.length > 0 ? (
                    <MeetingSyncedTranscript utterances={utterances} currentTime={currentTime} onSeek={handleSeek} />
                  ) : recording.transcript?.trim() ? (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{recording.transcript}</div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Todavía no hay transcripción disponible.</p>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
