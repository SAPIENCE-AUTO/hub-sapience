import { GRIS } from '../../lib/toolColors';
import { COLOR_STATUS } from './estilos';

/** El estado de un pago como pill «sólido chico»: relleno del color del estado, texto blanco y un punto. */
export function PillPago({ status }: { status?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 text-white"
      style={{ backgroundColor: COLOR_STATUS[status ?? ''] ?? GRIS }}
    >
      <span className="h-1 w-1 rounded-full bg-white/80" />
      {status || '—'}
    </span>
  );
}
