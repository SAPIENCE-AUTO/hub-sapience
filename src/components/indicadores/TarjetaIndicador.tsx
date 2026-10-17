import { useEffect, useState } from 'react';
import { estadoMeta, leerMeta, type EstadoMeta } from '../../lib/indicadores/reclutamiento';
import { EXITO, GRIS, PELIGRO, TEAL } from '../../lib/toolColors';
import { fmtPct } from './formato';

export const COLOR_META: Record<EstadoMeta, string> = { enMeta: EXITO, fuera: PELIGRO, sinMeta: GRIS };
const ETIQUETA_META: Record<EstadoMeta, string> = { enMeta: 'En meta', fuera: 'Fuera de meta', sinMeta: 'Sin meta' };

/**
 * Un indicador contra su meta: el porcentaje grande (verde si va en meta, rojo si no, teal si aún no hay meta), una frase en palabras
 * llanas con los números y la meta que Sergio escribe. La meta se guarda al salir del campo o con Enter; dejarlo vacío la quita.
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
  const [texto, setTexto] = useState(meta === undefined ? '' : String(meta));
  useEffect(() => { setTexto(meta === undefined ? '' : String(meta)); }, [meta]);

  const guardar = () => {
    const v = leerMeta(texto);
    if (v === undefined) { setTexto(meta === undefined ? '' : String(meta)); return; } // lo escrito no vale: se deja la meta como estaba
    if ((v ?? undefined) !== meta) onMeta(v);
  };

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
      <label className="mt-3 flex items-center gap-2 border-t pt-3 text-[11px] text-muted-foreground">
        <span>Meta ({mejor === 'menos' ? 'máximo' : 'mínimo'})</span>
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          placeholder="—"
          aria-label={`Meta de ${etiqueta}`}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTexto(meta === undefined ? '' : String(meta)); e.currentTarget.blur(); } }}
          className="w-14 rounded-md border bg-background px-2 py-1 text-right text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
        />
        <span>%</span>
      </label>
    </div>
  );
}
