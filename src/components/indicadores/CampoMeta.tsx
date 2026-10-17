import { useEffect, useState } from 'react';
import { leerMeta } from '../../lib/indicadores/reclutamiento';

/**
 * El campo donde se escribe la meta de un indicador (en %). Se guarda al salir del campo o con Enter; vacío la quita; Escape deja lo que
 * había. Lo que no es un porcentaje válido (de 0 a 100) se descarta y se vuelve a la meta de antes.
 */
export function CampoMeta({ etiqueta, mejor, meta, onMeta, corto = false }: {
  etiqueta: string;
  mejor: 'menos' | 'mas';
  meta: number | undefined;
  onMeta: (valor: number | null) => void;
  corto?: boolean;
}) {
  const [texto, setTexto] = useState(meta === undefined ? '' : String(meta));
  useEffect(() => { setTexto(meta === undefined ? '' : String(meta)); }, [meta]);

  const guardar = () => {
    const v = leerMeta(texto);
    if (v === undefined) { setTexto(meta === undefined ? '' : String(meta)); return; }
    if ((v ?? undefined) !== meta) onMeta(v);
  };

  return (
    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>{corto ? `Meta ${mejor === 'menos' ? 'máx.' : 'mín.'}` : `Meta (${mejor === 'menos' ? 'máximo' : 'mínimo'})`}</span>
      <input
        type="text"
        inputMode="decimal"
        value={texto}
        placeholder="—"
        aria-label={`Meta de ${etiqueta}`}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTexto(meta === undefined ? '' : String(meta)); e.currentTarget.blur(); } }}
        className={`${corto ? 'w-12' : 'w-14'} rounded-md border bg-background px-2 py-1 text-right text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#0F3D4D]/40`}
      />
      <span>%</span>
    </label>
  );
}
