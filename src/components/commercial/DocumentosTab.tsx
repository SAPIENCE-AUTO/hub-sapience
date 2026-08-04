import { useState, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { getDealDocuments, GetDealDocumentsOutputType, saveDealDocument, deleteDealDocument } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, Upload, ExternalLink, FileText, Paperclip, FileEdit, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/markdown-editor';

type Doc = GetDealDocumentsOutputType['documents'][0];

const DOC_TYPES = ['Brief de cliente', 'Notas de brief', 'Solicitud de cambios', 'Propuesta PPT', 'Propuesta PDF', 'Otro'];

const DOC_COLORS: Record<string, string> = {
  'Brief de cliente': 'hsl(var(--chart-5))',
  'Notas de brief': 'hsl(var(--chart-1))',
  'Solicitud de cambios': 'hsl(var(--chart-4))',
  'Propuesta PPT': 'hsl(var(--chart-3))',
  'Propuesta PDF': 'hsl(var(--destructive))',
  'Otro': 'hsl(var(--muted-foreground))',
};

export default function DocumentosTab({ dealId }: { dealId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<'file' | 'editable'>('file');
  const [form, setForm] = useState({ documentName: '', docType: 'Brief de cliente', version: '' });
  const [fileInfo, setFileInfo] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Editor state
  const [editorDoc, setEditorDoc] = useState<Doc | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaveStatus, setEditorSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Refs to avoid stale closures in debounced callback
  const editorContentRef = useRef('');
  const editorDocRef = useRef<Doc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { const d = await getDealDocuments({ dealId }); setDocs(d.documents); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [dealId]);

  // Keep refs in sync
  useEffect(() => { editorDocRef.current = editorDoc; }, [editorDoc]);

  const performSave = async (content: string) => {
    const doc = editorDocRef.current;
    if (!doc) return;
    setEditorSaveStatus('saving');
    try {
      await saveDealDocument({ id: doc.id, content });
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, content } : d));
      setEditorSaveStatus('saved');
      setEditorDirty(false);
    } catch {
      setEditorSaveStatus('idle');
      toast.error('Error al guardar');
    }
  };

  const debouncedSave = useDebouncedCallback(() => {
    performSave(editorContentRef.current);
  }, 1500);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { fileUrl: url } = await uploadFile({ data: file, filename: file.name });
      setFileInfo({ url, name: file.name });
      if (!form.documentName) setForm(f => ({ ...f, documentName: file.name.replace(/\.[^.]+$/, '') }));
    } catch { toast.error('Error al subir el archivo'); }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.documentName) { toast.error('El nombre es requerido'); return; }
    setSaving(true);
    try {
      if (addMode === 'editable') {
        const result = await saveDealDocument({
          documentName: form.documentName, deal: [dealId],
          docType: form.docType, version: form.version || undefined,
          uploadDate: new Date().toISOString().split('T')[0],
          content: '',
        });
        toast.success('Documento creado');
        setForm({ documentName: '', docType: 'Brief de cliente', version: '' });
        const d = await getDealDocuments({ dealId });
        setDocs(d.documents);
        const newDoc = d.documents.find(doc => doc.id === result.id);
        if (newDoc) { openEditor(newDoc); }
      } else {
        await saveDealDocument({
          documentName: form.documentName, deal: [dealId],
          docType: form.docType, version: form.version || undefined,
          fileUrl: fileInfo?.url, fileName: fileInfo?.name,
          uploadDate: new Date().toISOString().split('T')[0],
        });
        toast.success('Documento guardado');
        setForm({ documentName: '', docType: 'Brief de cliente', version: '' });
        setFileInfo(null);
        if (fileRef.current) fileRef.current.value = '';
        load();
      }
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteDealDocument({ id: deletingId });
    toast.success('Documento eliminado');
    setDeletingId(null);
    load();
  };

  const openEditor = (doc: Doc) => {
    setEditorDoc(doc);
    editorDocRef.current = doc;
    const content = doc.content ?? '';
    setEditorContent(content);
    editorContentRef.current = content;
    setEditorDirty(false);
    setEditorSaveStatus('idle');
  };

  const handleEditorManualSave = async () => {
    debouncedSave.cancel();
    await performSave(editorContentRef.current);
  };

  const handleEditorClose = async () => {
    debouncedSave.cancel();
    if (editorDirty && editorSaveStatus !== 'saved') {
      await performSave(editorContentRef.current);
    }
    setEditorDoc(null);
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agregar documento</p>

        {/* Type toggle */}
        <div className="flex border rounded-lg overflow-hidden w-full">
          <button
            type="button"
            onClick={() => setAddMode('file')}
            className={`flex-1 text-sm py-1.5 px-3 transition-colors font-medium ${addMode === 'file' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:bg-muted/50'}`}
          >
            <Paperclip className="w-3.5 h-3.5 inline mr-1.5" />Subir archivo
          </button>
          <button
            type="button"
            onClick={() => setAddMode('editable')}
            className={`flex-1 text-sm py-1.5 px-3 transition-colors font-medium ${addMode === 'editable' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:bg-muted/50'}`}
          >
            <FileEdit className="w-3.5 h-3.5 inline mr-1.5" />Crear documento
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Tipo</Label>
            <Select value={form.docType} onValueChange={v => setForm(f => ({ ...f, docType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Versión</Label>
            <Input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} placeholder="v1, v2..." />
          </div>
          <div className="col-span-2 space-y-1"><Label>Nombre del documento *</Label>
            <Input value={form.documentName} onChange={e => setForm(f => ({ ...f, documentName: e.target.value }))} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {addMode === 'file' && (
            <>
              <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
              <Button variant="outline" size="sm" className="gap-2 flex-1" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><Upload className="w-4 h-4 animate-pulse" /> Subiendo...</> : fileInfo ? <><Paperclip className="w-4 h-4" />{fileInfo.name}</> : <><Upload className="w-4 h-4" /> Seleccionar archivo</>}
              </Button>
            </>
          )}
          {addMode === 'editable' && (
            <p className="text-xs text-muted-foreground flex-1">Se abrirá el editor al crear el documento.</p>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || uploading}>
            {saving ? 'Guardando...' : addMode === 'editable' ? 'Crear y editar' : 'Agregar'}
          </Button>
        </div>
      </div>

      {/* Document list */}
      <div className="space-y-2">
        {docs.map(doc => {
          const color = DOC_COLORS[doc.docType ?? ''] ?? 'hsl(var(--muted-foreground))';
          const isEditable = !doc.fileUrl && doc.content !== undefined;
          return (
            <div
              key={doc.id}
              className={`flex items-center gap-3 border rounded-lg p-3 transition-colors ${isEditable ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/20'}`}
              onClick={() => isEditable && openEditor(doc)}
            >
              <div className="p-2 rounded-lg flex-shrink-0" style={{ backgroundColor: color + '18' }}>
                {isEditable ? <FileEdit className="w-4 h-4" style={{ color }} /> : <FileText className="w-4 h-4" style={{ color }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{doc.documentName}</span>
                  {isEditable && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium flex-shrink-0">Editable</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                  <span style={{ color }}>{doc.docType}</span>
                  {doc.version && <span>· {doc.version}</span>}
                  {doc.uploadDate && <span>· {new Date(doc.uploadDate).toLocaleDateString('es-MX')}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {doc.fileUrl && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" /></a>
                  </Button>
                )}
                {isEditable && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditor(doc)}>
                    <FileEdit className="w-3 h-3" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeletingId(doc.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          );
        })}
        {docs.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed rounded-xl">Sin documentos.</div>
        )}
      </div>

      {/* Editor dialog */}
      <Dialog open={!!editorDoc} onOpenChange={open => !open && handleEditorClose()}>
        <DialogContent className="max-w-5xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-base truncate">{editorDoc?.documentName || 'Documento'}</DialogTitle>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{editorDoc?.docType}</span>
                  {editorDoc?.version && <span className="text-xs text-muted-foreground">· {editorDoc.version}</span>}
                  {editorSaveStatus === 'saving' && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Guardando...
                    </span>
                  )}
                  {editorSaveStatus === 'saved' && (
                    <span className="text-xs text-chart-2 font-medium">Guardado ✓</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={handleEditorClose}>Cerrar</Button>
                <Button size="sm" onClick={handleEditorManualSave} disabled={editorSaveStatus === 'saving' || !editorDirty}>
                  {editorSaveStatus === 'saving' ? 'Guardando...' : 'Guardar'}
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <MarkdownEditor
              content={editorContent}
              onChange={md => {
                setEditorContent(md);
                editorContentRef.current = md;
                setEditorDirty(true);
                setEditorSaveStatus('idle');
                debouncedSave();
              }}
              height="dynamic-lg"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={!!deletingId} onOpenChange={o => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
