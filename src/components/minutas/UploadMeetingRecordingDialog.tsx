import { useRef, useState } from 'react';
import { createMuxUploadUrl, startMeetingTranscription, BASE } from 'zite-endpoints-sdk';
import { supabase } from '@/lib/supabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Upload, Loader2, FileAudio } from 'lucide-react';
import { toast } from 'sonner';

const ACCEPTED = 'audio/*,video/*';

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '';
  const mbps = bps / (1024 * 1024);
  return mbps >= 1 ? `${mbps.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;
}

/** XHR (no fetch) porque solo XHR da eventos de progreso reales — mismo patrón que uploadWithProgress en streamvault/src/contexts/UploadContext.tsx. */
function uploadWithProgress(
  url: string, method: 'PUT' | 'POST', file: File, headers: Record<string, string>,
  onProgress?: (pct: number, speedBps: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0, lastTime = Date.now();
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable || !onProgress) return;
      const now = Date.now(), dt = (now - lastTime) / 1000;
      const speed = dt > 0.1 ? (e.loaded - lastLoaded) / dt : 0;
      lastLoaded = e.loaded; lastTime = now;
      onProgress((e.loaded / e.total) * 100, speed);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 400) { reject(new Error(`HTTP ${xhr.status}`)); return; }
      resolve(xhr.responseText);
    });
    xhr.addEventListener('error', () => reject(new Error('Error de red')));
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.send(file);
  });
}

// Minutas / notetaker (sep 2026): alta manual para juntas grabadas por otra
// vía — "video o audio, indistinto" (Sergio), "no quiero subir el audio o
// video a supabase... debería subir a mux", y después: "en sharpli desde
// que subo audio hasta que tengo la transcripción es mucho más rápido...
// deberíamos [replicar ese proceso]". Se copia el patrón real de Sharpli
// (streamvault/src/contexts/UploadContext.tsx): el navegador manda el mismo
// archivo EN PARALELO a Mux (Direct Upload) y a AssemblyAI, en vez de subir
// solo a Mux y esperar a que genere un rendition de audio antes de
// transcribir (lo que hacía todo mucho más lento). Única diferencia real
// con Sharpli: ahí el navegador sube directo a AssemblyAI con su API key
// expuesta al cliente (su propio código lo marca "SECURITY TODO" — como acá
// se comparte la MISMA cuenta/key, eso expondría una key compartida a
// cualquiera con sesión en el Hub). Aquí la subida a AssemblyAI pasa por
// server/assemblyRelay.ts, que retransmite el archivo en streaming sin
// guardar la key en el cliente — mismo paralelismo, sin ese riesgo.
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
  const [progress, setProgress] = useState(0);
  const [speedBps, setSpeedBps] = useState(0);
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

  const reset = () => {
    setFile(null); setSubject(''); setProgress(0); setSpeedBps(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!file) { toast.error('Elige un archivo de audio o video'); return; }
    if (!subject.trim()) { toast.error('Ponle un título a la minuta'); return; }
    setUploading(true);
    setProgress(0);
    setSpeedBps(0);
    try {
      const { uploadUrl, recordingId } = await createMuxUploadUrl({ subject: subject.trim(), projectId, dealId });

      const { data: sessionData } = await supabase.auth.getSession();
      const authHeader = sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {};

      // Mux y AssemblyAI en paralelo — el mismo archivo va a los dos a la
      // vez, no uno después del otro. La barra de progreso solo refleja Mux
      // (el destino que de verdad importa mostrar, igual que en Sharpli).
      const [muxResult, assemblyResult] = await Promise.allSettled([
        uploadWithProgress(uploadUrl, 'PUT', file, { 'Content-Type': file.type || 'application/octet-stream' }, (pct, speed) => {
          setProgress(pct);
          setSpeedBps(speed);
        }),
        uploadWithProgress(`${BASE}/uploadToAssemblyAI`, 'POST', file, { 'Content-Type': file.type || 'application/octet-stream', ...authHeader }),
      ]);

      if (muxResult.status === 'rejected') throw muxResult.reason;

      if (assemblyResult.status === 'fulfilled') {
        try {
          const { uploadUrl: assemblyUploadUrl } = JSON.parse(assemblyResult.value) as { uploadUrl: string };
          await startMeetingTranscription({ recordingId, assemblyUploadUrl });
        } catch (err) {
          console.error('[UploadMeetingRecordingDialog] error iniciando transcripción', err);
          toast.warning('Minuta subida — la transcripción no pudo iniciar, se puede reintentar después');
        }
      } else {
        toast.warning('Minuta subida — no se pudo transcribir automáticamente');
      }

      toast.success('Minuta subida');
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
            Sube tu video o grabación para transcribirlo y obtener una minuta.
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
          {uploading && (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{Math.round(progress)}%</span>
                {speedBps > 0 && <span>{formatSpeed(speedBps)}</span>}
              </div>
            </div>
          )}
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
