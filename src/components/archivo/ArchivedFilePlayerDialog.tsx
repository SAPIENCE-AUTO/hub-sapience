import { useEffect, useState } from 'react';
import { getArchivedFileUrl } from 'zite-endpoints-sdk';
import { Download, Link2, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ShareWithClientPanel from './ShareWithClientPanel';
import { archivoLink, formatBytes, formatDate, mediaKind } from './utils';

interface FileInfo {
  id: string;
  fileName: string;
  projectFolder: string;
  sharepointPath: string;
  sizeBytes: number;
  contentType?: string;
  originalModifiedAt?: string;
}

// Reproductor de un archivo del archivo de grabaciones (Azure Blob). El link
// que devuelve getArchivedFileUrl es un SAS de 2 h: se pide al abrir, nunca se
// guarda ni se comparte — para compartir se copia el link del Hub.
export default function ArchivedFilePlayerDialog({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFile(null);
    setError(null);
    setSharing(false);
    if (!fileId) return;
    getArchivedFileUrl({ id: fileId })
      .then(res => { setUrl(res.url); setFile(res.file); })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo abrir el archivo'));
  }, [fileId]);

  const handleDownload = async () => {
    if (!fileId) return;
    setDownloading(true);
    try {
      const res = await getArchivedFileUrl({ id: fileId, download: true });
      window.location.href = res.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo descargar');
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!fileId) return;
    await navigator.clipboard.writeText(archivoLink(fileId));
    toast.success('Link copiado — solo abre para usuarios del Hub');
  };

  const kind = file ? mediaKind(file) : 'other';

  return (
    <Dialog open={!!fileId} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] grid-cols-[minmax(0,1fr)]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="pr-6 break-words min-w-0">{file?.fileName ?? 'Abriendo archivo…'}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !url && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {url && kind === 'video' && (
          <video src={url} controls autoPlay className="w-full max-h-[65vh] rounded-md bg-black" />
        )}
        {url && kind === 'audio' && <audio src={url} controls autoPlay className="w-full" />}
        {url && kind === 'other' && (
          <p className="text-sm text-muted-foreground py-4">Este tipo de archivo no se puede previsualizar; descárgalo para abrirlo.</p>
        )}

        {file && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-muted-foreground min-w-0 flex-1 basis-60">
              <p className="truncate" title={file.sharepointPath}>SharePoint: {file.sharepointPath}</p>
              <p>{formatBytes(file.sizeBytes)} · modificado {formatDate(file.originalModifiedAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant={sharing ? 'secondary' : 'outline'} className="h-8 gap-1.5" onClick={() => setSharing(v => !v)}>
                <Share2 className="h-3.5 w-3.5" /> Compartir con cliente
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleCopyLink}>
                <Link2 className="h-3.5 w-3.5" /> Copiar link
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Descargar
              </Button>
            </div>
          </div>
        )}
        {file && sharing && <ShareWithClientPanel target={{ scope: 'file', fileId: file.id }} />}
      </DialogContent>
    </Dialog>
  );
}
