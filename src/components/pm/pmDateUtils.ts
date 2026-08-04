import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

export function fmtDate(d: Date): string { const day = String(d.getDate()).padStart(2, '0'); const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', ''); const year = d.getFullYear(); return `${day}-${mon}-${year}`; }

export function fmt(d: Date) { return format(d, 'd MMM', { locale: es }).replace(/\.$/, ''); }

export function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function normalizeRange(a: Date, b: Date): { from: Date; to: Date } {
  const from = new Date(a); from.setHours(0, 0, 0, 0);
  const to   = new Date(b); to.setHours(0, 0, 0, 0);
  return from <= to ? { from, to } : { from: to, to: from };
}
