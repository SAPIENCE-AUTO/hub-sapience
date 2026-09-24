import { useEffect, useState } from 'react';
import { getMeetingRecordings } from 'zite-endpoints-sdk';
import { Video, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MeetingRecordingDetailDialog, { type MeetingRecording } from './MeetingRecordingDetailDialog';
import UploadMeetingRecordingDialog from './UploadMeetingRecordingDialog';

const STATUS_LABEL: Record<string, string> = {
  joining: 'Uniéndose…',
  in_waiting_room: 'En la sala de espera…',
  in_call_not_recording: 'En la junta (sin grabar)',
  in_call_recording: 'Grabando',
  call_ended: 'Junta terminada — procesando',
  uploading: 'Subiendo…',
  processing: 'Procesando grabación…',
  ready: 'Lista',
  transcription_error: 'Error al transcribir',
  fatal: 'Error — no se pudo unir',
};

function formatDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Minutas / notetaker (sep 2026): lista de grabaciones ligadas a este
// proyecto o deal (getMeetingRecordings filtra por uno u otro) — tanto las
// que llegan solas por el notetaker de Sapience como las que alguien sube a
// mano (grabadas por otra vía: audio o video, indistinto). Vive junto a
// ProjectMinutas (las minutas escritas a mano) en Documentos, y como pestaña
// nueva en DealDetailSheet.
export default function MeetingRecordingsSection({ projectId, dealId }: {
  projectId?: string;
  dealId?: string;
}) {
  const [recordings, setRecordings] = useState<MeetingRecording[] | null>(null);
  const [selected, setSelected] = useState<MeetingRecording | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchRecordings = () => {
    getMeetingRecordings(projectId ? { projectId } : dealId ? { dealId } : {})
      .then(res => setRecordings(res.recordings))
      .catch(() => setRecordings([]));
  };

  useEffect(() => {
    setRecordings(null);
    fetchRecordings();
  }, [projectId, dealId]);

  if (recordings === null) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando minutas…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full bg-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Minutas (grabaciones de junta)</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setUploadOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> Subir grabación
        </Button>
      </div>
      {recordings.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          Todavía no hay minutas aquí. Llegan solas cuando el notetaker de Sapience graba una junta relacionada, o puedes subir un audio o video grabado por otra vía.
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
      <UploadMeetingRecordingDialog
        projectId={projectId}
        dealId={dealId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={fetchRecordings}
      />
    </div>
  );
}
