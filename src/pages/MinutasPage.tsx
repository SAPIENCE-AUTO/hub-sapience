import { useState, useEffect, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getMinutasOverview, getMeetingRecordings, addNotetakerToMeeting } from 'zite-endpoints-sdk';
import { Video, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import MeetingPipelineSteps from '../components/minutas/MeetingPipelineSteps';
import LinkMeetingRecordingPopover, { DEAL_LINK_ALLOWED_EMAILS } from '../components/minutas/LinkMeetingRecordingPopover';
import MeetingRecordingDetailDialog, { type MeetingRecording } from '../components/minutas/MeetingRecordingDetailDialog';

interface RecordingSummary {
  id: string;
  status?: string;
  muxPlaybackId?: string;
  assemblyTranscriptId?: string;
  hasTranscript: boolean;
  project?: string[];
  deal?: string[];
}

interface Session {
  key: string;
  subject: string;
  start: string;
  end: string;
  joinUrl?: string;
  provider?: 'teams' | 'zoom';
  graphEventId?: string;
  recording?: RecordingSummary;
}

function formatDateTime(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function SessionRow({ session, now, allowDeals, onOpenDetail, onChanged }: {
  session: Session;
  now: number;
  allowDeals: boolean;
  onOpenDetail: (recordingId: string) => void;
  onChanged: () => void;
}) {
  const [sending, setSending] = useState(false);
  const startMs = session.start ? new Date(session.start).getTime() : NaN;
  const endMs = session.end ? new Date(session.end).getTime() : NaN;
  const isOngoing = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now <= endMs;
  const isPast = !Number.isNaN(endMs) && now > endMs;
  const canAddNotetaker = session.joinUrl && !session.recording && !isPast;

  const handleAdd = async () => {
    setSending(true);
    try {
      await addNotetakerToMeeting({
        meetingUrl: session.joinUrl,
        subject: session.subject,
        meetingStart: session.start,
        meetingEnd: session.end,
        graphEventId: session.graphEventId,
      });
      toast.success('Notetaker enviado a la junta');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo agregar el notetaker');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`bg-card border rounded-lg p-3 flex items-center justify-between gap-3 ${isOngoing ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
      <button
        onClick={() => session.recording && onOpenDetail(session.recording.id)}
        disabled={!session.recording}
        className="min-w-0 flex-1 text-left flex items-center gap-2 disabled:cursor-default"
      >
        <Video className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug truncate">{session.subject}</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <Clock className="w-3 h-3" />
            {formatDateTime(session.start)}
            {session.provider && <span className="uppercase text-[10px] font-semibold ml-1">{session.provider}</span>}
            {isOngoing && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-primary ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> En curso
              </span>
            )}
            {isPast && !session.recording && <span className="text-[10px] ml-1">· pasada</span>}
          </span>
        </div>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        {session.recording && <MeetingPipelineSteps recording={session.recording} />}
        {session.recording && (
          <LinkMeetingRecordingPopover
            recordingId={session.recording.id}
            projectId={session.recording.project?.[0]}
            dealId={session.recording.deal?.[0]}
            allowDeals={allowDeals}
            onLinked={onChanged}
          />
        )}
        {canAddNotetaker && (
          <button
            onClick={handleAdd}
            disabled={sending}
            className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-2.5 py-1.5 rounded-md"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
            Agregar notetaker
          </button>
        )}
      </div>
    </div>
  );
}

// Minutas / notetaker (sep 2026): "un apartado de minutas donde vengan
// todas las sesiones (pasadas, ongoing y futuras)... diga si ya está
// vinculada... o vincular ahí mismo" (Sergio) — reemplaza los widgets
// sueltos del Dashboard (Mis juntas de hoy + Minutas sin vincular) con una
// sola vista. Acotado a sergio@sapience.com.mx en el nav (Layout.tsx),
// mismo alcance que el resto del piloto — los datos ya vienen filtrados por
// usuario desde el propio endpoint (context.user.email).
export default function MinutasPage() {
  const { user } = useAuth();
  const allowDeals = !!user?.email && DEAL_LINK_ALLOWED_EMAILS.includes(user.email);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedRecording, setSelectedRecording] = useState<MeetingRecording | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchSessions = useCallback(() => {
    getMinutasOverview({}).then(res => setSessions(res.sessions)).catch(() => setSessions(prev => prev ?? []));
  }, []);

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 60_000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const openDetail = async (recordingId: string) => {
    setLoadingDetail(true);
    try {
      const res = await getMeetingRecordings({ id: recordingId });
      setSelectedRecording(res.recordings[0] ?? null);
    } catch {
      toast.error('No se pudo cargar la minuta');
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold">Minutas</h1>
        <p className="text-sm text-muted-foreground">Tus juntas de los últimos 7 días y próximas 2 semanas — con o sin grabación.</p>
      </div>

      {sessions === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No hay juntas en este rango de fechas.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <SessionRow key={s.key} session={s} now={now} allowDeals={allowDeals} onOpenDetail={openDetail} onChanged={fetchSessions} />
          ))}
        </div>
      )}

      {loadingDetail && (
        <div className="fixed inset-0 bg-background/60 flex items-center justify-center z-50">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      <MeetingRecordingDetailDialog recording={selectedRecording} open={!!selectedRecording} onClose={() => setSelectedRecording(null)} />
    </div>
  );
}
