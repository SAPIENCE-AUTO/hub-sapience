// Formato de las cifras de Pagos de análisis / management, al estilo de México.
import { MONEDAS, type EstadoReparto, type Moneda } from '../../lib/pagosManagement/reparto';
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

/** AAAA-MM-DD → DD/MM/AAAA. */
export const fmtFecha = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

export const ETIQUETA_ESTADO: Record<EstadoReparto, string> = { sinRepartir: 'Sin repartir', incompleto: 'Incompleto', completo: 'Completo', excedido: 'Pasa de 100 %' };
/** El mismo color siempre quiere decir lo mismo: gris nada repartido, azul falta, verde completo, naranja se pasó (un aviso: se puede guardar así). */
export const COLOR_ESTADO_REPARTO: Record<EstadoReparto, string> = { sinRepartir: GRIS, incompleto: INFO, completo: EXITO, excedido: ALERTA };
