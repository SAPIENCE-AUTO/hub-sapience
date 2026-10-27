// Cómo se escriben los números del tablero (dinero, conteos, porcentajes, días) y los cambios contra el periodo de comparación.
import type { Formato, MonedaAlcance } from './tipos';

export const SIN_DATO = '—';

/**
 * Escribe un valor. `compacto` acorta el dinero ($32.5M, $350K) para ejes y tarjetas; sin compacto sale completo ($32,463,415) para tablas y detalles.
 * Los porcentajes de las medidas vienen como fracción (0.88 = 88 %).
 */
export function formatear(v: number | null | undefined, f: Formato, moneda: MonedaAlcance = 'todas', compacto = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return SIN_DATO;
  switch (f) {
    case 'porcentaje':
      return `${(v * 100).toFixed(1)}%`;
    case 'dias':
      return `${Math.round(v)} d`;
    case 'numero':
      return Math.round(v).toLocaleString('es-MX');
    case 'moneda': {
      const signo = v < 0 ? '-' : '';
      const a = Math.abs(v);
      const pre = moneda === 'USD' ? 'USD $' : '$';
      if (!compacto) return `${signo}${pre}${Math.round(a).toLocaleString('es-MX')}`;
      // Los umbrales son los que ya redondean a la unidad de arriba: 999,600 sale «$1.0M» y no «$1000K».
      if (a >= 999_500) return `${signo}${pre}${(a / 1_000_000).toFixed(1)}M`;
      if (a >= 999.5) return `${signo}${pre}${Math.round(a / 1_000)}K`;
      return `${signo}${pre}${Math.round(a)}`;
    }
  }
}

export interface Cambio {
  abs: number;
  /** null cuando no hay contra qué calcularlo (el valor de comparación es cero). */
  pct: number | null;
}

/** Cuánto cambió un valor contra el de comparación; null si falta alguno de los dos. */
export function cambio(valor: number | null | undefined, previo: number | null | undefined): Cambio | null {
  if (valor === null || valor === undefined || previo === null || previo === undefined) return null;
  return { abs: valor - previo, pct: previo !== 0 ? ((valor - previo) / Math.abs(previo)) * 100 : null };
}

export function formatearPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
