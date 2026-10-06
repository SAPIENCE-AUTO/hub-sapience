import { useEffect, useState } from 'react';
import { getArchivedFiles } from 'zite-endpoints-sdk';
import ArchivedFileList from './ArchivedFileList';
import ArchivedFilePlayerDialog from './ArchivedFilePlayerDialog';
import { type ArchivedFile, formatBytes } from './utils';

// Sección "Archivo (SharePoint)" de la pestaña Documentos del proyecto:
// grabaciones que se movieron de SharePoint a Azure Blob para liberar cuota.
// Si el proyecto no tiene nada archivado no se muestra (la mayoría de los
// proyectos recientes no tendrán).
export default function ArchivedFilesSection({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<ArchivedFile[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setFiles(null);
    getArchivedFiles({ projectId })
      .then(res => setFiles(res.files))
      .catch(() => setFiles([]));
  }, [projectId]);

  if (!files || files.length === 0) return null;
  const total = files.reduce((s, f) => s + f.sizeBytes, 0);

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-full bg-primary" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Archivo (SharePoint)</span>
        <span className="text-xs text-muted-foreground">· {files.length} archivos · {formatBytes(total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Grabaciones que se movieron de SharePoint a almacenamiento de archivo. En la carpeta original quedó un acceso directo a cada una.
      </p>
      <ArchivedFileList files={files} onOpen={setOpenId} />
      <ArchivedFilePlayerDialog fileId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
