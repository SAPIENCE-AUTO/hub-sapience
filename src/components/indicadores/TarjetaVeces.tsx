import { estadoMeta } from '../../lib/indicadores/reclutamiento';
import { GRIS, TEAL } from '../../lib/toolColors';
import { CampoMeta } from './CampoMeta';
import { COLOR_META } from './TarjetaIndicador';
import { fmtPct } from './formato';

/**
 * Una cajita chica de un tramo («2 veces», «5 o más veces»…): el porcentaje de su grupo, cuántas personas son y la meta (máximo). La de
 * «Primera vez» no lleva meta. El estado solo aparece cuando hay meta, para no llenar la pantalla de «sin meta».
 */
export function TarjetaVeces({ etiqueta, nombreMeta, color, pct, detalle, meta, onMeta }: {
  etiqueta: string;
  /** Cómo se nombra el campo de la meta para quien usa lector de pantalla: «4 veces» solo se repite en los dos grupos. */
  nombreMeta?: string;
  /** El color del tramo, el mismo de la leyenda y de las barras; sin color para «Primera vez». */
  color?: string;
  pct: number | null;
  detalle: string;
  meta?: number;
  onMeta?: (valor: number | null) => void;
}) {
  const estado = estadoMeta(pct, meta, 'menos');
  return (
    <div className="flex flex-col rounded-xl border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        {color && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />}
        {etiqueta}
      </p>
      <p className="mt-1 text-[24px] font-bold leading-none tracking-tight" style={{ color: pct === null ? GRIS : estado === 'sinMeta' ? TEAL : COLOR_META[estado] }}>{fmtPct(pct)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detalle}</p>
      {onMeta && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          <CampoMeta corto etiqueta={nombreMeta ?? etiqueta} mejor="menos" meta={meta} onMeta={onMeta} />
          {estado !== 'sinMeta' && (
            <span className="inline-block rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: COLOR_META[estado] }}>
              {estado === 'enMeta' ? 'En meta' : 'Fuera de meta'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
