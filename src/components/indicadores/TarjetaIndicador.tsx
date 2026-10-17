import { estadoMeta, type EstadoMeta } from '../../lib/indicadores/reclutamiento';
import { EXITO, GRIS, PELIGRO, TEAL } from '../../lib/toolColors';
import { CampoMeta } from './CampoMeta';
import { fmtPct } from './formato';

export const COLOR_META: Record<EstadoMeta, string> = { enMeta: EXITO, fuera: PELIGRO, sinMeta: GRIS };
const ETIQUETA_META: Record<EstadoMeta, string> = { enMeta: 'En meta', fuera: 'Fuera de meta', sinMeta: 'Sin meta' };

/**
 * Un indicador contra su meta: el porcentaje grande (verde si va en meta, rojo si no, teal si aún no hay meta), una frase en palabras
 * llanas con los números y la meta que Sergio escribe.
 */
export function TarjetaIndicador({ etiqueta, frase, pct, mejor, meta, onMeta }: {
  etiqueta: string;
  /** Qué quiere decir el porcentaje, con los números; va siempre a la vista. */
  frase: string;
  pct: number | null;
  mejor: 'menos' | 'mas';
  meta: number | undefined;
  onMeta: (valor: number | null) => void;
}) {
  const estado = estadoMeta(pct, meta, mejor);
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-snug">{etiqueta}</p>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: COLOR_META[estado] }}>
          {ETIQUETA_META[estado]}
        </span>
      </div>
      <p className="mt-1.5 text-[30px] font-bold leading-none tracking-tight" style={{ color: pct === null ? GRIS : estado === 'sinMeta' ? TEAL : COLOR_META[estado] }}>{fmtPct(pct)}</p>
      <p className="mt-2 flex-1 text-xs leading-snug text-muted-foreground">{pct === null ? 'Sin personas en este periodo.' : frase}</p>
      <div className="mt-3 border-t pt-3">
        <CampoMeta etiqueta={etiqueta} mejor={mejor} meta={meta} onMeta={onMeta} />
      </div>
    </div>
  );
}
