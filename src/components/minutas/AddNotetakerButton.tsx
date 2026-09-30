import { useState } from 'react';
import { addNotetakerToMeeting } from 'zite-endpoints-sdk';
import { Video, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface NotetakerSession {
  subject: string;
  start: string;
  end: string;
  joinUrl?: string;
  graphEventId?: string;
}

// Extraído de MinutasPage.tsx (antes vivía solo en SessionRow) para poder
// reusarlo también en la vista de calendario (MinutasDayView.tsx) sin
// duplicar la llamada a addNotetakerToMeeting en dos lugares.
export default function AddNotetakerButton({ session, onChanged, compact }: {
  session: NotetakerSession;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [sending, setSending] = useState(false);

  const handleAdd = async () => {
    setSending(true);
    try {
      await addNotetakerToMeeting({
        meetingUrl: session.joinUrl,
        subject: session.subject,
        meetingStart: session.start,
        meetingEnd: session.end,
        graphEventId: session.graphEventId,
      });
      toast.success('Notetaker enviado a la junta');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo agregar el notetaker');
    } finally {
      setSending(false);
    }
  };

  if (compact) {
    return (
      <button
        onClick={e => { e.stopPropagation(); handleAdd(); }}
        disabled={sending}
        title="Agregar notetaker a la junta"
        className="flex items-center gap-1 h-5 px-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0 text-[9px] font-semibold"
      >
        {sending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Video className="w-2.5 h-2.5" />}
        Push
      </button>
    );
  }

  return (
    <button
      onClick={handleAdd}
      disabled={sending}
      className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-2.5 py-1.5 rounded-md"
    >
      {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
      Agregar notetaker
    </button>
  );
}
