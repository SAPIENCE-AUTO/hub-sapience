import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string;
  projectName?: string;
}

export function TimelinePreviewDialog({ open, onOpenChange, fileUrl, projectName }: Props) {
  const embedUrl = fileUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b border-border/50 flex-shrink-0">
          <DialogTitle className="text-sm font-semibold">
            Timeline — {projectName || 'Proyecto'}
          </DialogTitle>
          {fileUrl && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs flex-shrink-0"
              onClick={() => window.open(fileUrl, '_blank')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir en nueva pestaña
            </Button>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {fileUrl ? (
            <iframe
              src={embedUrl}
              className="w-full h-full border-0"
              title={`Timeline ${projectName || ''}`}
              allowFullScreen
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No hay archivo disponible
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
