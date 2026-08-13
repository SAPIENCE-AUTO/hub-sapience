import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink, RefreshCw, Loader2, X } from 'lucide-react';
import type { CalEvent } from './pmTypes';

const invStatusColors: Record<string, string> = {
  'Enviado': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Por actualizar': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'Por crear': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Cancelado': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

interface InvitePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalEvent | null;
  outlookSyncing: boolean;
  onOutlookSync: (action: 'create' | 'update' | 'cancel') => void;
}

/**
 * Entry point directly from the "Outlook" status badge in the events list —
 * shows the actual invite HTML plus the create/update/cancel actions,
 * without opening the full event-edit form (EventDetailDialog still has its
 * own copy of this same block for whoever edits the event that way).
 */
export function InvitePreviewDialog({ open, onOpenChange, event, outlookSyncing, onOutlookSync }: InvitePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-border">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-sm font-semibold truncate">{event?.eventName}</DialogTitle>
            {event?.inviteStatus && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${invStatusColors[event.inviteStatus] ?? 'bg-muted text-muted-foreground'}`}>
                {event.inviteStatus}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {event?.inviteBodyHtml ? (
            <iframe srcDoc={event.inviteBodyHtml} className="w-full h-full border-0"
              title="Vista previa del email de Outlook" sandbox="allow-same-origin" />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
              Aún no se ha generado la invitación — créala para ver aquí el correo que recibirán los asistentes.
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          {event?.outlookEventLink ? (
            <a href={event.outlookEventLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="w-3 h-3" /> Ver en Outlook
            </a>
          ) : <span />}
          <div className="flex items-center gap-2">
            {event?.outlookEventId && (
              <Button size="sm" variant="ghost"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onOutlookSync('cancel')} disabled={outlookSyncing}>
                <X className="w-3 h-3" /> Cancelar invitación
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => onOutlookSync(event?.outlookEventId ? 'update' : 'create')}
              disabled={outlookSyncing}>
              {outlookSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {event?.outlookEventId ? 'Actualizar invitación' : 'Crear invitación'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
