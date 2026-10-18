// Formato de las cifras de Pagos de análisis / management, al estilo de México.
import { MONEDAS, type EstadoDeal, type EstadoReparto, type Moneda, type UnidadCotizada } from '../../lib/pagosManagement/reparto';
import { ALERTA, EXITO, GRIS, INFO } from '../../lib/toolColors';

/** «$35,000», «$13,513.51», «USD 700»: sin centavos cuando no hacen falta. */
export const fmtMonto = (n: number, moneda: Moneda = 'MXN'): string =>
  n.toLocaleString('es-MX', { style: 'currency', currency: moneda, minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Hasta dos decimales: 33.333334 → «33.33 %», 50 → «50 %». */
export const fmtPct = (n: number): string => `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`;

/** Varias monedas en una línea, solo las que tienen algo: «$27,500 + USD 350». Sin nada, «$0». */
export function fmtMontos(porMoneda: Record<Moneda, number>): string {
  const partes = MONEDAS.filter((m) => Math.abs(porMoneda[m]) > 0.004).map((m) => fmtMonto(porMoneda[m], m));
  return partes.length ? partes.join(' + ') : fmtMonto(0);
}

/** Cómo se cotizó el Management de un deal: «40 × $2,000 + 6 × $12,000». */
export const fmtUnidades = (unidades: UnidadCotizada[], moneda: Moneda): string =>
  unidades.map((u) => `${u.cantidad.toLocaleString('es-MX', { maximumFractionDigits: 2 })} × ${fmtMonto(u.precio, moneda)}`).join(' + ');

/** AAAA-MM-DD → DD/MM/AAAA. */
export const fmtFecha = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

export const ETIQUETA_ESTADO: Record<EstadoReparto, string> = { sinRepartir: 'Sin repartir', incompleto: 'Incompleto', completo: 'Completo', excedido: 'Pasa de 100 %' };
/** Lo mismo para un deal: cuánto de lo cotizado ya está repartido entre proyectos. */
export const ETIQUETA_ESTADO_DEAL: Record<EstadoDeal, string> = { sinAsignar: 'Sin asignar', parcial: 'Por asignar', completo: 'Completo', excedido: 'Se pasa' };
/** El mismo color siempre quiere decir lo mismo: gris nada repartido, azul falta, verde completo, naranja se pasó (un aviso: se puede guardar así). */
export const COLOR_ESTADO_REPARTO: Record<EstadoReparto, string> = { sinRepartir: GRIS, incompleto: INFO, completo: EXITO, excedido: ALERTA };
export const COLOR_ESTADO_DEAL: Record<EstadoDeal, string> = { sinAsignar: GRIS, parcial: INFO, completo: EXITO, excedido: ALERTA };
