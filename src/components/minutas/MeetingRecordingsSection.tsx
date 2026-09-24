import { useEffect, useState } from 'react';
import { getMeetingRecordings } from 'zite-endpoints-sdk';
import { Video, CheckCircle2, Loader2 } from 'lucide-react';
import MeetingRecordingDetailDialog, { type MeetingRecording } from './MeetingRecordingDetailDialog';

const STATUS_LABEL: Record<string, string> = {
  joining: 'Uniéndose…',
  in_waiting_room: 'En la sala de espera…',
  in_call_not_recording: 'En la junta (sin grabar)',
  in_call_recording: 'Grabando',
  call_ended: 'Junta terminada — procesando',
  processing: 'Procesando grabación…',
  ready: 'Lista',
  transcription_error: 'Error al transcribir',
  fatal: 'Error — no se pudo unir',
};

function formatDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Minutas / notetaker (sep 2026): lista de grabaciones auto-generadas por el
// notetaker, vinculadas a este proyecto o deal (getMeetingRecordings filtra
// por uno u otro). Vive junto a ProjectMinutas (las minutas escritas a mano)
// en Documentos, y como pestaña nueva en DealDetailSheet.
export default function MeetingRecordingsSection({ projectId, dealId, hideWhenEmpty }: {
  projectId?: string;
  dealId?: string;
  /** true en Documentos de Proyecto (sección embebida sobre otro contenido) — el
   * piloto del notetaker es de un solo usuario hoy, así que casi ningún proyecto
   * tiene minutas todavía, y un aviso vacío ahí sería puro ruido para el resto
   * del equipo. La pestaña dedicada de Deal sí explica el estado vacío. */
  hideWhenEmpty?: boolean;
}) {
  const [recordings, setRecordings] = useState<MeetingRecording[] | null>(null);
  const [selected, setSelected] = useState<MeetingRecording | null>(null);

  useEffect(() => {
    setRecordings(null);
    getMeetingRecordings(projectId ? { projectId } : dealId ? { dealId } : {})
      .then(res => setRecordings(res.recordings))
      .catch(() => setRecordings([]));
  }, [projectId, dealId]);

  if (recordings === null) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando minutas…</div>;
  }

  if (recordings.length === 0 && hideWhenEmpty) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-full bg-primary" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Minutas (grabaciones de junta)</span>
      </div>
      {recordings.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          Todavía no hay minutas grabadas. Cuando el notetaker de Sapience grabe una junta relacionada, aparecerá aquí.
        </p>
      )}
      <div className="space-y-2">
        {recordings.map(r => {
          const ready = r.status === 'ready' && r.muxPlaybackId;
          return (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center justify-between gap-2 hover:border-primary/40 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-2">
                <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.subject || 'Sin título'}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.meetingStart ?? r.createdAt)}</p>
                </div>
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                {ready ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {STATUS_LABEL[r.status ?? ''] ?? r.status}
              </span>
            </button>
          );
        })}
      </div>
      <MeetingRecordingDetailDialog recording={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
