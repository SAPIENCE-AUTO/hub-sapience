import { useEffect, useState } from 'react';
import { getMeetingRecordings, deleteMeetingRecording, retryMeetingTranscription } from 'zite-endpoints-sdk';
import { Video, Loader2, Upload, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import MeetingRecordingDetailDialog, { type MeetingRecording } from './MeetingRecordingDetailDialog';
import UploadMeetingRecordingDialog from './UploadMeetingRecordingDialog';
import MeetingPipelineSteps from './MeetingPipelineSteps';

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
  const [pendingDelete, setPendingDelete] = useState<MeetingRecording | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchRecordings = () => {
    getMeetingRecordings(projectId ? { projectId } : dealId ? { dealId } : {})
      .then(res => setRecordings(res.recordings))
      .catch(() => setRecordings([]));
  };

  useEffect(() => {
    setRecordings(null);
    fetchRecordings();
  }, [projectId, dealId]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteMeetingRecording({ id: pendingDelete.id });
      setRecordings(prev => prev?.filter(r => r.id !== pendingDelete.id) ?? null);
      toast.success('Minuta borrada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo borrar la minuta');
    } finally {
      setDeleting(false);
      setPendingDelete(null);
      setDeleteConfirmText('');
    }
  };

  const handleRetry = async (r: MeetingRecording) => {
    setRetryingId(r.id);
    try {
      const result = await retryMeetingTranscription({ id: r.id });
      toast.success(result.status === 'started' ? 'Transcripción iniciada' : 'Preparando el audio — la transcripción arranca sola en unos minutos');
      fetchRecordings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo reintentar la transcripción');
    } finally {
      setRetryingId(null);
    }
  };

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
          const canRetry = !!r.muxPlaybackId && !r.transcript && !r.assemblyTranscriptId;
          return (
            <div
              key={r.id}
              className="w-full bg-card border border-border rounded-lg p-3 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors"
            >
              <button onClick={() => setSelected(r)} className="min-w-0 flex items-center gap-2 flex-1 text-left">
                <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.subject || 'Sin título'}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.meetingStart ?? r.createdAt)}</p>
                </div>
              </button>
              <div className="flex items-center gap-3 shrink-0">
                <MeetingPipelineSteps recording={r} />
                {canRetry && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRetry(r); }}
                    disabled={retryingId === r.id}
                    className="text-muted-foreground hover:text-primary transition-colors p-1 disabled:opacity-50"
                    title="Reintentar transcripción"
                  >
                    {retryingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(r); }}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  title="Borrar minuta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
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
      <Dialog open={!!pendingDelete} onOpenChange={v => { if (!v && !deleting) { setPendingDelete(null); setDeleteConfirmText(''); } }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Borrar "{pendingDelete?.subject || 'Sin título'}"</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Escribe BORRAR para confirmar"
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            disabled={deleting}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingDelete(null); setDeleteConfirmText(''); }} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || deleteConfirmText !== 'BORRAR'}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
