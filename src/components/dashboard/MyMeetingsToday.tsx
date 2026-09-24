import { useState, useEffect, useCallback, useRef } from 'react';
import { getMyMeetingsToday, addNotetakerToMeeting, getNotetakerBotStatus } from 'zite-endpoints-sdk';
import { Video, Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface Meeting {
  id: string;
  subject: string;
  start: string;
  end: string;
  joinUrl: string;
  provider: 'teams' | 'zoom';
}

// Piloto notetaker (sep 2026, solo sergio@sapience.com.mx — ver gate en
// DashboardPage.tsx): widget fijo, todavía fuera del grid configurable de
// widgets — hasta confirmar que la mecánica básica funciona no vale la pena
// meterlo al sistema de layout arrastrable.
const STATUS_LABEL: Record<string, { label: string; icon: 'loading' | 'ok' | 'error' }> = {
  joining_call: { label: 'Uniéndose…', icon: 'loading' },
  in_waiting_room: { label: 'En la sala de espera…', icon: 'loading' },
  in_call_not_recording: { label: 'En la junta (sin grabar)', icon: 'loading' },
  recording_permission_allowed: { label: 'Grabando', icon: 'ok' },
  in_call_recording: { label: 'Grabando', icon: 'ok' },
  recording_permission_denied: { label: 'El host no permitió grabar', icon: 'error' },
  call_ended: { label: 'Junta terminada — procesando', icon: 'loading' },
  done: { label: 'Grabación lista', icon: 'ok' },
  fatal: { label: 'Error — no se pudo unir', icon: 'error' },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function BotStatusPill({ botId }: { botId: string }) {
  const [status, setStatus] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await getNotetakerBotStatus({ botId });
      setStatus(res.status);
      setDownloadUrl(res.downloadUrl);
      if (res.status === 'done' || res.status === 'fatal') {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch {
      /* silencioso — el próximo tick reintenta */
    }
  }, [botId]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [poll]);

  const info = STATUS_LABEL[status] ?? { label: status || 'Iniciando…', icon: 'loading' as const };
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {info.icon === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {info.icon === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
      {info.icon === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
      <span className="text-muted-foreground">{info.label}</span>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          Descargar
        </a>
      )}
    </div>
  );
}

function MeetingRow({ meeting, isOngoing }: { meeting: Meeting; isOngoing: boolean }) {
  // botId no se "consume" al mostrarse — el mismo botón sigue disponible
  // después de mandar un bot, para el caso de reintentar si lo sacaron de
  // la junta (a petición explícita: un solo botón/label sirve para ambos
  // casos, sin distinguir "primera vez" de "reintento").
  const [botId, setBotId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleAdd = async () => {
    setSending(true);
    try {
      const res = await addNotetakerToMeeting({
        meetingUrl: meeting.joinUrl,
        subject: meeting.subject,
        meetingStart: meeting.start,
        meetingEnd: meeting.end,
        graphEventId: meeting.id,
      });
      setBotId(res.botId);
      toast.success('Notetaker enviado a la junta');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo agregar el notetaker');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`bg-card border rounded-lg p-3 space-y-2 ${isOngoing ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug truncate">{meeting.subject}</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <Clock className="w-3 h-3" />
            {formatTime(meeting.start)}–{formatTime(meeting.end)}
            <span className="uppercase text-[10px] font-semibold ml-1">{meeting.provider}</span>
            {isOngoing && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-primary ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                En curso
              </span>
            )}
          </span>
        </div>
        <button
          onClick={handleAdd}
          disabled={sending}
          className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-2.5 py-1.5 rounded-md flex-shrink-0"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
          Agregar notetaker a la junta
        </button>
      </div>
      {botId && <BotStatusPill key={botId} botId={botId} />}
    </div>
  );
}

// Se vuelve a pedir la lista cada minuto (juntas nuevas, canceladas, etc.) y
// el reloj de "ahora" se actualiza cada 15s — sin esto, "está pasando ahorita"
// se congelaba en el momento en que se abrió el Dashboard.
const REFETCH_MS = 60_000;
const CLOCK_TICK_MS = 15_000;

export default function MyMeetingsToday() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchMeetings = useCallback(() => {
    getMyMeetingsToday({}).then(res => setMeetings(res.meetings)).catch(() => setMeetings(prev => prev ?? []));
  }, []);

  useEffect(() => {
    fetchMeetings();
    const id = setInterval(fetchMeetings, REFETCH_MS);
    return () => clearInterval(id);
  }, [fetchMeetings]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (meetings === null || meetings.length === 0) return null;

  const isOngoing = (m: Meeting) => {
    const start = new Date(m.start).getTime();
    const end = new Date(m.end).getTime();
    return now >= start && now <= end;
  };

  // Las que están pasando ahorita, primero.
  const sorted = [...meetings].sort((a, b) => Number(isOngoing(b)) - Number(isOngoing(a)));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-full bg-primary" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Mis juntas de hoy (piloto notetaker)
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map(m => <MeetingRow key={m.id} meeting={m} isOngoing={isOngoing(m)} />)}
      </div>
    </div>
  );
}
