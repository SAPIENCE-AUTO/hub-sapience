import { useRef, useState } from 'react';
import { createMuxUploadUrl } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Loader2, FileAudio } from 'lucide-react';
import { toast } from 'sonner';

const ACCEPTED = 'audio/*,video/*';

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

// Minutas / notetaker (sep 2026): alta manual para juntas grabadas por otra
// vía (no por el notetaker de Sapience) — "video o audio, indistinto"
// (Sergio), y explícitamente "no quiero subir el audio o video a supabase...
// debería subir a mux". El archivo va DIRECTO del navegador a la URL firmada
// de Mux (createMuxUploadUrl.ts → PUT aquí mismo) — nunca toca uploadFile()/
// Supabase Storage ni el body limit de server/upload.ts, así que no hay
// techo de 50MB para esto.
export default function UploadMeetingRecordingDialog({ projectId, dealId, open, onClose, onUploaded }: {
  projectId?: string;
  dealId?: string;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (f: File) => {
    setFile(f);
    if (!subject.trim()) setSubject(stripExtension(f.name));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (uploading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const reset = () => { setFile(null); setSubject(''); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handleSubmit = async () => {
    if (!file) { toast.error('Elige un archivo de audio o video'); return; }
    if (!subject.trim()) { toast.error('Ponle un título a la minuta'); return; }
    setUploading(true);
    try {
      const { uploadUrl } = await createMuxUploadUrl({ subject: subject.trim(), projectId, dealId });
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!putRes.ok) throw new Error(`Mux rechazó la subida (${putRes.status})`);
      toast.success('Minuta subida — procesándose (video y transcripción tardan unos minutos)');
      reset();
      onUploaded();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la grabación');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !uploading) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Subir grabación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Para juntas grabadas por otra vía (sin el notetaker). Acepta audio o video de cualquier tamaño — se transcribe y queda lista para resumir igual que las demás minutas.
          </p>
          <div className="space-y-2">
            <Label>Archivo</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              onChange={handleFileChange}
              className="hidden"
              id="meeting-recording-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); if (!uploading) setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              disabled={uploading}
              className={`w-full flex items-center gap-2 border border-dashed rounded-lg px-3 py-3 text-sm transition-colors disabled:opacity-50 ${
                isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate text-left">{file ? file.name : 'Elegir audio o video, o arrástralo aquí…'}</span>
            </button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-recording-subject">Título</Label>
            <Input
              id="meeting-recording-subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Ej. Follow up con cliente — 23 sep"
              disabled={uploading}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (!uploading) { reset(); onClose(); } }} disabled={uploading}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={uploading}>
            {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Subiendo…</> : <><Upload className="h-4 w-4 mr-2" /> Subir</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
