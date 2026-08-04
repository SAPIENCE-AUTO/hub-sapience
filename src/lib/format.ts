export function fmtCurrency(amount?: number, currency?: string): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}
