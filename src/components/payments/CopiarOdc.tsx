import { Copy } from 'lucide-react';
import { toast } from 'sonner';

// La ODC es lo que se escribe en el concepto de la transferencia: un clic y se copia.
export function CopiarOdc({ numero }: { numero: string }) {
  return (
    <button
      type="button"
      title="Copiar ODC"
      aria-label={`Copiar ${numero}`}
      className="shrink-0 p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
      onClick={async e => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(numero);
          toast.success(`${numero} copiada`);
        } catch {
          toast.error('No se pudo copiar');
        }
      }}
    >
      <Copy className="w-3 h-3" />
    </button>
  );
}
