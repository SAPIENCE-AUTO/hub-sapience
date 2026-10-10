// Fechas de la pantalla de pagos. Todo se maneja como texto 'YYYY-MM-DD' (así llegan de la base) y las cuentas
// de días se hacen en UTC para que un cambio de horario no mueva un día.

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** '2026-10-09T00:00:00.000Z' → '2026-10-09'. Cualquier cosa que no sea fecha da null. */
export function soloFecha(d?: string | null): string | null {
  if (!d) return null;
  const f = d.split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
}

/**
 * El día de hoy según el reloj de quien usa la pantalla. No sirve `toISOString()`: da la fecha en UTC, y en México
 * después de las 6 pm ya es «mañana» en UTC.
 */
export function hoyLocalISO(ahora: Date = new Date()): string {
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function aUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function sumaDias(iso: string, dias: number): string {
  return new Date(aUtc(iso) + dias * 86400000).toISOString().slice(0, 10);
}

/** Días de `desde` a `hasta` (positivo si `hasta` es después). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86400000);
}

/** '2026-06-26' → '26 jun'; si es de otro año que `hoy`, '26 jun 2025'. */
export function fmtFechaCorta(iso?: string | null, hoy?: string): string {
  const f = soloFecha(iso);
  if (!f) return '—';
  const [y, m, d] = f.split('-').map(Number);
  const base = `${d} ${MESES_CORTOS[m - 1]}`;
  return hoy && hoy.slice(0, 4) === String(y) ? base : `${base} ${y}`;
}

export function nombreMes(iso: string): string {
  return MESES[Number(iso.slice(5, 7)) - 1];
}

export function nombreMesCorto(iso: string): string {
  return MESES_CORTOS[Number(iso.slice(5, 7)) - 1];
}

/** '2026-06-26' → '26 de junio'; si es de otro año que `hoy`, '3 de diciembre de 2025'. */
export function fmtFechaLarga(iso?: string | null, hoy?: string): string {
  const f = soloFecha(iso);
  if (!f) return '—';
  const base = `${diaDelMes(f)} de ${nombreMes(f)}`;
  return hoy && hoy.slice(0, 4) === f.slice(0, 4) ? base : `${base} de ${f.slice(0, 4)}`;
}

export function diaDelMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** '2026-10-09' → '2026-10'. */
export function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

/** 0 = domingo, 1 = lunes … 6 = sábado. */
export function diaDeLaSemana(iso: string): number {
  return new Date(aUtc(iso)).getUTCDay();
}

export function nombreDia(iso: string): string {
  return DIAS[diaDeLaSemana(iso)];
}

export function nombreDiaCorto(iso: string): string {
  return DIAS_CORTOS[diaDeLaSemana(iso)];
}

/** El lunes de la semana (de lunes a domingo) a la que pertenece la fecha. */
export function lunesDe(iso: string): string {
  return sumaDias(iso, -((diaDeLaSemana(iso) + 6) % 7));
}

/** '2026-12' + 1 → '2027-01'. */
export function sumaMeses(aaaamm: string, n: number): string {
  const [y, m] = aaaamm.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Meses de `desde` a `hasta` (positivo si `hasta` es después). */
export function mesesEntre(desde: string, hasta: string): number {
  const [y1, m1] = desde.split('-').map(Number);
  const [y2, m2] = hasta.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function diasDelMes(aaaamm: string): number {
  const [y, m] = aaaamm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** '2026-10' → 'Octubre 2026'. */
export function etiquetaMes(aaaamm: string): string {
  const nombre = MESES[Number(aaaamm.slice(5, 7)) - 1];
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${aaaamm.slice(0, 4)}`;
}
