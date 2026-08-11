import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Paperclip, Upload, Trash2, Loader2, Download } from 'lucide-react';
import { getPoAttachments, savePoAttachment, deletePoAttachment, GetPoAttachmentsOutputType } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { toast } from 'sonner';

type Attachment = GetPoAttachmentsOutputType['attachments'][0];

function getFileEmoji(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📄';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return '🖼️';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['mp4', 'mov', 'avi'].includes(ext)) return '🎥';
  return '📎';
}

function fmtDT(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  poId: string;
  status: string;
  userEmail: string;
  canUpload: boolean;
  isHighLevel: boolean;
  open: boolean;
}

export default function PoAttachmentsSection({ poId, status, userEmail, canUpload, isHighLevel, open }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [desc, setDesc] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !poId) return;
    setLoading(true);
    getPoAttachments({ poId })
      .then(d => setAttachments(d.attachments))
      .catch(() => setAttachments([]))
      .finally(() => setLoading(false));
  }, [open, poId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('El archivo no puede superar 25 MB');
      return;
    }
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name, folder: 'purchase-orders' });
      const result = await savePoAttachment({
        poId,
        fileUrl,
        fileName: file.name,
        description: desc.trim() || undefined,
      });
      setAttachments(prev => [...prev, result.attachment]);
      setDesc('');
      toast.success('Evidencia subida correctamente');
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Error al subir el archivo');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await deletePoAttachment({ id: confirmDelete.id });
      setAttachments(prev => prev.filter(a => a.id !== confirmDelete.id));
      toast.success('Evidencia eliminada');
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Error al eliminar');
    }
    setDeletingId(null);
    setConfirmDelete(null);
  };

  const showUpload = canUpload && status !== 'Cancelada';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
            Evidencias y adjuntos
            {attachments.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-foreground text-[10px] font-bold">
                {attachments.length}
              </span>
            )}
          </p>
        </div>

        {showUpload && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Descripción (opcional)"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="h-7 text-xs w-40"
              disabled={uploading}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 flex-shrink-0"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Upload className="w-3 h-3" />}
              {uploading ? 'Subiendo...' : 'Subir archivo'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : attachments.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground italic">
          <Paperclip className="w-4 h-4 opacity-40" />
          Sin evidencias adjuntas
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {attachments.map(att => {
            const canDel = att.uploadedByEmail === userEmail || isHighLevel;
            return (
              <div key={att.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 group transition-colors">
                <span className="text-lg flex-shrink-0 leading-none">{getFileEmoji(att.name)}</span>
                <div className="flex-1 min-w-0">
                  <a
                    href={att.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary hover:underline truncate block leading-tight"
                  >
                    {att.name}
                  </a>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {att.description && <span className="text-foreground/70 mr-1.5">{att.description} ·</span>}
                    <span>{att.uploadedByName || att.uploadedByEmail?.split('@')[0]}</span>
                    <span className="mx-1">·</span>
                    <span>{fmtDT(att.uploadedAt)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" download={att.name}>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Descargar">
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </a>
                  {canDel && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deletingId === att.id}
                      onClick={() => setConfirmDelete(att)}
                      title="Eliminar"
                    >
                      {deletingId === att.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar evidencia?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{confirmDelete?.name}</strong> permanentemente. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
