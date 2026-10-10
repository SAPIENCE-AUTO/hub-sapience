// Lo que el detalle de un pago muestra de su ODC: los conceptos (qué se compró y a cuánto) y su PDF. Solo formato y
// cuentas; la carga de datos vive en components/payments (ConceptosOdc, PdfOdc).
import { fmtMonto } from './formato';

/** Un concepto de la ODC, tal como lo devuelve getPoLineItems. */
export interface ConceptoOdc {
  id: string;
  description: string;
  category?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

const formatoCantidad = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

/**
 * Cuánto se compró en un concepto: «4 × $750». Si es una sola pieza por el mismo monto no hay nada que aclarar y
 * devuelve ''.
 */
export function detalleCantidad(c: Pick<ConceptoOdc, 'quantity' | 'unitPrice' | 'total'>, moneda?: string): string {
  if (c.quantity === 1 && c.unitPrice === c.total) return '';
  return `${formatoCantidad.format(c.quantity)} × ${fmtMonto(c.unitPrice, moneda)}`;
}

/** Hasta cuántos conceptos se muestran completos; una lista más larga se cierra y se abre a petición. */
export const CONCEPTOS_QUE_CABEN = 6;
/** Cuántos se ven cuando una lista larga está cerrada. */
export const CONCEPTOS_CON_LISTA_CERRADA = 4;

export function conceptosVisibles<T>(conceptos: ReadonlyArray<T>, expandido: boolean): { visibles: T[]; ocultos: number } {
  if (expandido || conceptos.length <= CONCEPTOS_QUE_CABEN) return { visibles: [...conceptos], ocultos: 0 };
  return { visibles: conceptos.slice(0, CONCEPTOS_CON_LISTA_CERRADA), ocultos: conceptos.length - CONCEPTOS_CON_LISTA_CERRADA };
}

/** Los bytes de un archivo que llega como base64 (con o sin el encabezado «data:…;base64,»), listos para abrirse en el navegador. */
export function base64ABlob(base64: string, tipo = 'application/pdf'): Blob {
  const limpio = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}
