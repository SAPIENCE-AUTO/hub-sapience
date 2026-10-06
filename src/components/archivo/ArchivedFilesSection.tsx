import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getArchivedFiles } from 'zite-endpoints-sdk';
import ArchivedFileList from './ArchivedFileList';
import ArchivedFilePlayerDialog from './ArchivedFilePlayerDialog';
import ShareScopeDialog, { type ScopeToShare } from './ShareScopeDialog';
import { type ArchivedFile, formatBytes } from './utils';

// Sección "Archivo (SharePoint)" de la pestaña Documentos del proyecto:
// grabaciones que se movieron de SharePoint a Azure Blob para liberar cuota.
// Si el proyecto no tiene nada archivado no se muestra (la mayoría de los
// proyectos recientes no tendrán).
export default function ArchivedFilesSection({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<ArchivedFile[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ScopeToShare | null>(null);

  useEffect(() => {
    setFiles(null);
    getArchivedFiles({ projectId })
      .then(res => setFiles(res.files))
      .catch(() => setFiles([]));
  }, [projectId]);

  if (!files || files.length === 0) return null;
  const total = files.reduce((s, f) => s + f.sizeBytes, 0);
  // Normalmente un proyecto del Hub = una carpeta raíz de SharePoint; si
  // hubiera varias, se comparte carpeta por carpeta.
  const roots = [...new Set(files.map(f => f.projectFolder))];

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-full bg-primary" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Archivo (SharePoint)</span>
        <span className="text-xs text-muted-foreground">· {files.length} archivos · {formatBytes(total)}</span>
        {roots.length === 1 && (
          <Button
            size="sm" variant="outline" className="h-7 text-xs gap-1.5 ml-auto"
            onClick={() => setShareTarget({ scope: 'project', pathPrefix: roots[0], label: roots[0], fileCount: files.length })}
          >
            <Share2 className="h-3.5 w-3.5" /> Compartir proyecto
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Grabaciones que se movieron de SharePoint a almacenamiento de archivo. En la carpeta original quedó un acceso directo a cada una.
      </p>
      <ArchivedFileList files={files} onOpen={setOpenId} onShare={setShareTarget} />
      <ArchivedFilePlayerDialog fileId={openId} onClose={() => setOpenId(null)} />
      <ShareScopeDialog target={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
