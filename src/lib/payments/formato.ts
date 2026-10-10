// Cómo se escriben los montos en la pantalla de pagos. `fmtCurrency` (lib/format.ts) redondea a pesos enteros: sirve
// para totales, pero el banco paga $6,765.41 y no $6,765, así que los renglones muestran los centavos cuando los hay.
import type { TotalesMoneda } from './urgencia';

function formateador(moneda: 'MXN' | 'USD', decimales: 0 | 2): Intl.NumberFormat {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Un monto con su moneda: '$6,543.21', '$900', 'USD 450'. Con `centavos: 'auto'` (lo normal) solo muestra los
 * centavos si el monto los tiene; con 'nunca' redondea a enteros (para totales).
 */
export function fmtMonto(amount?: number | null, currency?: string | null, opciones: { centavos?: 'auto' | 'nunca' } = {}): string {
  if (amount == null) return '—';
  const tieneCentavos = (opciones.centavos ?? 'auto') === 'auto' && Math.round(amount * 100) % 100 !== 0;
  return formateador(currency === 'USD' ? 'USD' : 'MXN', tieneCentavos ? 2 : 0).format(amount);
}

/** Los totales de un grupo: '$12,345 + USD 6,789'. Sin nada, '$0'. */
export function fmtTotales(t: TotalesMoneda): string {
  const partes: string[] = [];
  if (t.MXN && t.MXN.total !== 0) partes.push(fmtMonto(t.MXN.total, 'MXN', { centavos: 'nunca' }));
  if (t.USD && t.USD.total !== 0) partes.push(fmtMonto(t.USD.total, 'USD', { centavos: 'nunca' }));
  return partes.length ? partes.join(' + ') : '$0';
}

/**
 * 'Casa Estudios Norte - ana.lopez@ejemplo.test' → 'Casa Estudios Norte'. Varios proveedores se
 * guardaron con su correo pegado al nombre (para distinguir a dos personas con el mismo nombre); en la lista estorba.
 */
export function nombreSinCorreo(nombre?: string | null): string {
  if (!nombre) return '—';
  return nombre.replace(/\s+-\s+\S+@\S+\s*$/, '').trim() || nombre;
}

// Palabras que en un nombre propio van en minúscula, y siglas de razón social que se quedan en mayúscula.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'con', 'para', 'por']);
const SIGLAS = new Set(['sa', 'cv', 'rl', 'sas', 'sapi', 'sc', 'ac', 'srl', 'spa', 'llc', 'inc', 'ltd', 'ltda', 'uk', 'usa', 'ii', 'iii', 'iv']);

/**
 * 'ROSA ELENA VARGAS MONTIEL' → 'Rosa Elena Vargas Montiel'. Solo toca los nombres escritos todo en
 * mayúsculas (así se capturaron varios proveedores); uno que ya trae minúsculas se respeta tal cual.
 */
export function nombreLegible(nombre: string): string {
  const letras = nombre.replace(/[^\p{L}]/gu, '');
  if (!letras || letras !== letras.toUpperCase() || letras === letras.toLowerCase()) return nombre;
  let primera = true;
  return nombre.toLowerCase().replace(/\p{L}+/gu, palabra => {
    const esPrimera = primera;
    primera = false;
    if (SIGLAS.has(palabra)) return palabra.toUpperCase();
    if (!esPrimera && PARTICULAS.has(palabra)) return palabra;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
  });
}

/** Cómo se ve el proveedor en pantalla: sin el correo pegado y sin gritar en mayúsculas. */
export function nombreProveedor(nombre?: string | null): string {
  return nombreLegible(nombreSinCorreo(nombre));
}

export function capitaliza(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** '1 pago', '2 pagos'. Si el plural no es solo agregar «s» (proveedor → proveedores), se pasa aparte. */
export const plural = (n: number, singular: string, formaPlural = `${singular}s`) => `${n} ${n === 1 ? singular : formaPlural}`;

/** Los totales de un periodo, uno por moneda y cada uno en su renglón: ['$12,345', '+ USD 678']. */
export function lineasTotales(t: TotalesMoneda): string[] {
  const lineas: string[] = [];
  const mxn = t.MXN && t.MXN.total !== 0 ? fmtMonto(t.MXN.total, 'MXN', { centavos: 'nunca' }) : null;
  const usd = t.USD && t.USD.total !== 0 ? fmtMonto(t.USD.total, 'USD', { centavos: 'nunca' }) : null;
  if (mxn) lineas.push(mxn);
  if (usd) lineas.push(mxn ? `+ ${usd}` : usd);
  return lineas;
}
