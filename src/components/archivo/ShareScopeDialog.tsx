import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ShareWithClientPanel from './ShareWithClientPanel';

export interface ScopeToShare {
  scope: 'folder' | 'project';
  pathPrefix: string;
  label: string;
  fileCount: number;
}

// "Compartir con cliente" de una carpeta o proyecto completo (el de un solo
// video vive dentro del reproductor).
export default function ShareScopeDialog({ target, onClose }: { target: ScopeToShare | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] grid-cols-[minmax(0,1fr)]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="break-words pr-6">
            Compartir {target?.scope === 'project' ? 'proyecto' : 'carpeta'} «{target?.label}»
          </DialogTitle>
        </DialogHeader>
        {target && (
          <>
            <p className="text-xs text-muted-foreground -mt-2">
              {target.fileCount} {target.fileCount === 1 ? 'archivo' : 'archivos'} hoy. Con el link normal, lo que se archive
              después en {target.scope === 'project' ? 'este proyecto' : 'esta carpeta'} también le aparecerá al cliente.
            </p>
            <ShareWithClientPanel target={{ scope: target.scope, pathPrefix: target.pathPrefix }} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
