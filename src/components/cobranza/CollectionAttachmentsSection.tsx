import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Paperclip, Upload, Trash2, Loader2, Download } from 'lucide-react';
import { saveCollectionAttachment, deleteCollectionAttachment } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { toast } from 'sonner';

// Mismo patrón que PoAttachmentsSection.tsx, con un selector de tipo de
// documento junto al botón de subir — a diferencia de PO, aquí un mismo
// proceso de cobranza puede tener varios documentos de tipos distintos.
export type CollectionAttachment = {
  id: string;
  docType: string;
  name?: string;
  fileUrl?: string;
  description?: string;
  uploadedByEmail?: string;
  uploadedByName?: string;
  uploadedAt?: string;
};

const DOC_TYPES = ['Orden de compra cliente', 'Factura', 'Comprobante de plataforma', 'Otro'] as const;

function getFileEmoji(name?: string) {
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📄';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(ext)) return '🖼️';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📝';
  return '📎';
}

function fmtDT(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface Props {
  collectionProcessId: string;
  attachments: CollectionAttachment[];
  loading: boolean;
  canManage: boolean;
  userEmail: string;
  onChange: (attachments: CollectionAttachment[]) => void;
}

export default function CollectionAttachmentsSection({ collectionProcessId, attachments, loading, canManage, userEmail, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<typeof DOC_TYPES[number]>('Orden de compra cliente');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CollectionAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('El archivo no puede superar 25 MB');
      return;
    }
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name, folder: 'collection-processes' });
      const result = await saveCollectionAttachment({
        collectionProcessId,
        docType,
        fileUrl,
        fileName: file.name,
      });
      onChange([...attachments, result.attachment]);
      toast.success('Documento subido correctamente');
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al subir el archivo');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await deleteCollectionAttachment({ id: confirmDelete.id });
      onChange(attachments.filter(a => a.id !== confirmDelete.id));
      toast.success('Documento eliminado');
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error al eliminar');
    }
    setDeletingId(null);
    setConfirmDelete(null);
  };

  const grouped = DOC_TYPES.map(t => ({ type: t, items: attachments.filter(a => a.docType === t) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
            Documentos
            {attachments.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-foreground text-[10px] font-bold">
                {attachments.length}
              </span>
            )}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <Select value={docType} onValueChange={v => setDocType(v as typeof DOC_TYPES[number])}>
              <SelectTrigger className="h-7 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 flex-shrink-0"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Subiendo...' : 'Subir archivo'}
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : attachments.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground italic">
          <Paperclip className="w-4 h-4 opacity-40" />
          Sin documentos todavía
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.filter(g => g.items.length > 0).map(g => (
            <div key={g.type}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">{g.type}</p>
              <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                {g.items.map(att => {
                  const canDel = canManage && (att.uploadedByEmail === userEmail || true);
                  return (
                    <div key={att.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 group transition-colors">
                      <span className="text-lg flex-shrink-0 leading-none">{getFileEmoji(att.name)}</span>
                      <div className="flex-1 min-w-0">
                        <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline truncate block leading-tight">
                          {att.name}
                        </a>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
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
                            {deletingId === att.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{confirmDelete?.name}</strong> permanentemente. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
