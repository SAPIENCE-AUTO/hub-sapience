import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getMinutasOverview, getMeetingRecordings } from 'zite-endpoints-sdk';
import { Video, Loader2, Clock, List, CalendarDays, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import MeetingPipelineSteps from '../components/minutas/MeetingPipelineSteps';
import LinkMeetingRecordingPopover, { DEAL_LINK_ALLOWED_EMAILS } from '../components/minutas/LinkMeetingRecordingPopover';
import MeetingRecordingDetailDialog, { type MeetingRecording } from '../components/minutas/MeetingRecordingDetailDialog';
import AddNotetakerButton from '../components/minutas/AddNotetakerButton';
import MinutasDayView from '../components/minutas/MinutasDayView';

export interface RecordingSummary {
  id: string;
  status?: string;
  muxPlaybackId?: string;
  assemblyTranscriptId?: string;
  hasTranscript: boolean;
  project?: string[];
  deal?: string[];
}

export interface Session {
  key: string;
  subject: string;
  start: string;
  end: string;
  joinUrl?: string;
  provider?: 'teams' | 'zoom';
  graphEventId?: string;
  recording?: RecordingSummary;
}

type ViewMode = 'list' | 'day';

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
  const startMs = session.start ? new Date(session.start).getTime() : NaN;
  const endMs = session.end ? new Date(session.end).getTime() : NaN;
  const isOngoing = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now <= endMs;
  const isPast = !Number.isNaN(endMs) && now > endMs;
  const canAddNotetaker = session.joinUrl && !session.recording && !isPast;

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
        {canAddNotetaker && <AddNotetakerButton session={session} onChanged={onChanged} />}
      </div>
    </div>
  );
}

// Minutas / notetaker (sep 2026): "un apartado de minutas donde vengan
// todas las sesiones (pasadas, ongoing y futuras)... diga si ya está
// vinculada... o vincular ahí mismo" (Sergio) — reemplaza los widgets
// sueltos del Dashboard (Mis juntas de hoy + Minutas sin vincular) con una
// sola vista, ya visible para todo el equipo en el nav (Layout.tsx). El
// alcance de qué ve cada quien (propias + las de sus proyectos como
// líder/analista) lo resuelve getMinutasOverview.ts del lado del servidor,
// no esta página.
export default function MinutasPage() {
  const { user } = useAuth();
  const allowDeals = !!user?.email && DEAL_LINK_ALLOWED_EMAILS.includes(user.email);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  // false = Microsoft no contestó al pedir el calendario de Outlook: solo se ven las juntas que ya tienen grabación.
  const [calendarioDisponible, setCalendarioDisponible] = useState(true);
  // El calendario trae las juntas de la semana que se esté viendo (con las flechas se puede ir a cualquier semana). Sin rango (null) se pide la ventana de
  // siempre (últimos 7 días y próximas 2 semanas), que ya incluye la semana de hoy: es lo que usan la lista y la primera carga del calendario.
  const [rangoSemana, setRangoSemana] = useState<{ desde: string; hasta: string } | null>(null);
  const [cargandoSemana, setCargandoSemana] = useState(false);
  const ultimoPedido = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [selectedRecording, setSelectedRecording] = useState<MeetingRecording | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('minutas-view') as ViewMode) ?? 'day'; } catch { return 'day'; }
  });

  const handleViewMode = (v: ViewMode) => {
    setViewMode(v);
    setRangoSemana(null); // el calendario vuelve a abrir en la semana de hoy
    try { localStorage.setItem('minutas-view', v); } catch {}
  };

  // Solo el calendario pide una semana en particular; la lista siempre usa la ventana de siempre.
  const rangoPedido = viewMode === 'day' ? rangoSemana : null;

  const fetchSessions = useCallback((conIndicador = false) => {
    const pedido = ++ultimoPedido.current;
    if (conIndicador) setCargandoSemana(true);
    getMinutasOverview(rangoPedido ?? {})
      .then(res => {
        if (pedido !== ultimoPedido.current) return; // llegó tarde: mientras tanto se pidió otra semana
        setSessions(res.sessions);
        setCalendarioDisponible(res.calendarioDisponible !== false);
      })
      .catch(() => { if (pedido === ultimoPedido.current) setSessions(prev => prev ?? []); })
      .finally(() => { if (pedido === ultimoPedido.current) setCargandoSemana(false); });
  }, [rangoPedido]);

  // Lo que se pasa a los botones de abajo (agregar Notetaker, vincular): refrescan en silencio, sin el indicador de «cargando semana».
  const refrescar = useCallback(() => fetchSessions(false), [fetchSessions]);

  useEffect(() => {
    fetchSessions(true);
    const id = setInterval(() => fetchSessions(false), 60_000);
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
    <div className={`mx-auto p-6 space-y-4 ${viewMode === 'day' ? 'max-w-[1400px]' : 'max-w-4xl'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Notetaker</h1>
          <p className="text-sm text-muted-foreground">
            {viewMode === 'day'
              ? 'Tus juntas con liga de Teams o Zoom de la semana que veas, con o sin grabación. Cambia de semana con las flechas.'
              : 'Tus juntas de los últimos 7 días y próximas 2 semanas — con o sin grabación.'}
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
          <button
            onClick={() => handleViewMode('list')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <List className="w-3.5 h-3.5" /> Lista
          </button>
          <button
            onClick={() => handleViewMode('day')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-l border-border transition-colors ${viewMode === 'day' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <CalendarDays className="w-3.5 h-3.5" /> Calendario
          </button>
        </div>
      </div>

      {sessions !== null && !calendarioDisponible && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>No se pudo leer tu calendario de Outlook en este momento (puede ser una falla de Microsoft). Por ahora solo se ven las juntas que ya tienen grabación; se vuelve a intentar cada minuto.</span>
        </div>
      )}

      {sessions === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : viewMode === 'day' ? (
        <MinutasDayView
          sessions={sessions} now={now} allowDeals={allowDeals} onOpenDetail={openDetail} onChanged={refrescar}
          onSemanaChange={(desde, hasta) => setRangoSemana({ desde: desde.toISOString(), hasta: hasta.toISOString() })}
          cargando={cargandoSemana}
        />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No hay juntas en este rango de fechas.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <SessionRow key={s.key} session={s} now={now} allowDeals={allowDeals} onOpenDetail={openDetail} onChanged={refrescar} />
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
