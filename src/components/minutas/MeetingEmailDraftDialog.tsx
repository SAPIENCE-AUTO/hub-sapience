import { useEffect, useState } from 'react';
import { generateMeetingEmail } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Copy, Mail } from 'lucide-react';
import { toast } from 'sonner';

interface EmailDraft { subject: string; body: string }

// Minutas / notetaker (sep 2026): "quisiera poder usar este resumen/minuta
// como base para trabajar... redactar un mail interno o para mail a
// cliente" (Sergio) — nunca envía nada, solo redacta un borrador editable
// que se copia y se manda desde el propio correo del usuario.
export default function MeetingEmailDraftDialog({ meetingRecordingId, emailType, onClose }: {
  meetingRecordingId: string;
  emailType: 'interno' | 'cliente' | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!emailType) { setDraft(null); return; }
    setLoading(true);
    setDraft(null);
    generateMeetingEmail({ meetingRecordingId, emailType })
      .then(setDraft)
      .catch(err => {
        toast.error(err instanceof Error ? err.message : 'No se pudo redactar el correo');
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailType, meetingRecordingId]);

  const copyAll = () => {
    if (!draft) return;
    navigator.clipboard.writeText(`Asunto: ${draft.subject}\n\n${draft.body}`).then(
      () => toast.success('Correo copiado'),
      () => toast.error('No se pudo copiar — el navegador bloqueó el acceso al portapapeles'),
    );
  };

  return (
    <Dialog open={!!emailType} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Borrador de correo {emailType === 'cliente' ? 'a cliente' : 'interno'}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
            <Loader2 className="h-4 w-4 animate-spin" /> Redactando…
          </div>
        ) : draft ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Asunto</label>
              <Input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cuerpo</label>
              <Textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} className="mt-1 min-h-[280px] text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">Es un borrador — revísalo, ajústalo y envíalo desde tu correo.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
              <Button size="sm" onClick={copyAll}><Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar correo</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
