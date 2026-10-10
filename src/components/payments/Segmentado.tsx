import type { ReactNode } from 'react';

export interface OpcionSegmentado<V extends string> {
  valor: V;
  etiqueta: string;
  icono?: ReactNode;
}

/**
 * Selector de dos o tres opciones: la activa va rellena de tinta (casi negro). En la cabecera de la página va sobre
 * blanco; dentro de una tarjeta, sobre gris suave.
 */
export function Segmentado<V extends string>({ opciones, valor, onCambio, etiqueta, sobre = 'pagina' }: {
  opciones: ReadonlyArray<OpcionSegmentado<V>>;
  valor: V;
  onCambio: (v: V) => void;
  etiqueta: string;
  sobre?: 'pagina' | 'tarjeta';
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      className={`inline-flex items-center gap-0.5 rounded-[10px] border p-[3px] ${sobre === 'pagina' ? 'bg-card' : 'bg-muted'}`}
    >
      {opciones.map(o => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={`inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${valor === o.valor ? 'bg-foreground text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {o.icono}
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
