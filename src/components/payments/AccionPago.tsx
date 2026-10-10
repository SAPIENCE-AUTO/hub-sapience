import { CheckCircle2, Paperclip } from 'lucide-react';
import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { EXITO } from '../../lib/toolColors';

type Payment = GetPaymentsOutputType['payments'][0];

/**
 * Lo que se puede hacer con un pago desde su renglón: registrarlo si está por pagar (abre el detalle, donde se
 * confirma) o abrir su comprobante si ya se pagó. Lo comparten la tabla y el panel del día del calendario.
 */
export function AccionPago({ p, onAbrir }: { p: Payment; onAbrir: (p: Payment) => void }) {
  const adjunto = (p.attachment ?? [])[0];
  if (p.status === 'Programado') {
    return (
      <div className="flex items-center justify-end gap-1.5">
        {adjunto && <span title="Ya tiene comprobante cargado"><Paperclip className="w-3.5 h-3.5" style={{ color: EXITO }} /></span>}
        <button
          type="button"
          onClick={() => onAbrir(p)}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border bg-gradient-to-b from-white to-[hsl(220_20%_98%)] px-[11px] py-[5px] text-xs font-semibold text-foreground/80 shadow-sm transition-colors hover:to-muted"
        >
          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: EXITO }} />
          Registrar pago
        </button>
      </div>
    );
  }
  if (p.status === 'Realizado' && adjunto) {
    return (
      <a
        href={adjunto.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs hover:underline"
        style={{ color: EXITO }}
        title="Ver comprobante"
      >
        <Paperclip className="w-3.5 h-3.5" /> Comprobante
      </a>
    );
  }
  return null;
}
