import { NDA_COLOR, NDA_ETIQUETA, type EstadoVisible } from '@/lib/nda';

/** Pill «sólido chico» del sistema del Hub (relleno de color, texto blanco, esquinas de 6 px, puntito blanco), como EstadoPill pero con los estados del NDA (y «No llegó», en ámbar, cuando el correo rebotó). */
export function NdaPill({ estado, title }: { estado: EstadoVisible; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
      style={{ backgroundColor: NDA_COLOR[estado] }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {NDA_ETIQUETA[estado]}
    </span>
  );
}
