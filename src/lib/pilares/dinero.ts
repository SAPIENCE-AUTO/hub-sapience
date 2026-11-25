// Montos de pesos para la captura del reparto por pilar: leer lo que escribe la persona («$1,234.50», «1234.5», «1 234») y escribirlo de vuelta. Lógica pura. Pruebas:
// server/scripts/test-pilares-logica.ts.

import { redondear } from './reparto';

/** Máximo que se acepta en un campo de dinero (evita basura pegada por error). */
export const MONTO_MAXIMO = 999_999_999_999;

/**
 * Lee un monto escrito a mano. Vacío → null (sin monto). Lo que no es un monto válido → NaN (la pantalla lo marca; el servidor lo rechaza).
 * Convención mexicana: la coma separa miles y el punto los decimales; una sola coma seguida de 1 o 2 dígitos al final (sin punto) se toma como decimal.
 */
export function leerMonto(texto: string | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  const limpio = texto.replace(/[\s $]/g, '');
  if (limpio === '') return null;
  if (!/^[0-9.,]+$/.test(limpio)) return NaN;
  let numerico: string;
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(limpio)) numerico = limpio.replace(/,/g, ''); // 1,234 o 1,234,567.89 (comas bien puestas de miles)
  else if (/^(\d+\.?\d*|\.\d+)$/.test(limpio)) numerico = limpio; // 1234, 1234.5 o .5
  else if (/^\d+,\d{1,2}$/.test(limpio)) numerico = limpio.replace(',', '.'); // 1,5 (coma decimal)
  else return NaN;
  const n = Number(numerico);
  if (!Number.isFinite(n) || n < 0 || n > MONTO_MAXIMO) return NaN;
  return redondear(n);
}

/** La moneda corta de un deal: «MXN 🇲🇽» → «MXN». Sin moneda cuenta como MXN, igual que el tablero. */
export function monedaCorta(moneda: string | null | undefined): string {
  const c = (moneda ?? '').trim().slice(0, 3).toUpperCase();
  return c || 'MXN';
}

/** «$1,234.5» en pesos; «USD 1,234.5» en otra moneda. Sin decimales cuando no los hay y hasta dos cuando sí. */
export function formatoMonto(n: number | null | undefined, moneda: string = 'MXN'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const cuerpo = Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const signo = n < 0 ? '-' : '';
  return moneda === 'MXN' ? `${signo}$${cuerpo}` : `${signo}${moneda} ${cuerpo}`;
}

/** «70%», «33.3%»; vacío como raya. */
export function formatoPorcentaje(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/** Lo que se muestra dentro de un campo de monto al editarlo: sin signo de pesos ni comas, para que se pueda corregir. */
export function montoParaEditar(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
