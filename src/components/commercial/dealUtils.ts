export const PHASES = [
  { key: 'Prospecto', color: 'hsl(var(--muted-foreground))' },
  { key: 'Brief recibido', color: 'hsl(var(--chart-5))' },
  { key: 'Cotización enviada', color: 'hsl(var(--chart-4))' },
  { key: 'Negociación', color: 'hsl(var(--chart-1))' },
  { key: 'Ganado', color: 'hsl(var(--chart-2))' },
  { key: 'Perdido', color: 'hsl(var(--destructive))' },
] as const;

export const PHASE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  PHASES.map(p => [p.key, p.color])
);

export const RUBROS = [
  'Reclutamiento e incentivos',
  'Moderación',
  'Management',
  'Logística y operación',
  'Back office',
] as const;

export const COTIZ_STATUSES = ['Borrador', 'Enviada', 'Aprobada', 'Rechazada'] as const;

export const COTIZ_STATUS_COLORS: Record<string, string> = {
  Borrador: 'hsl(var(--muted-foreground))',
  Enviada: 'hsl(var(--chart-5))',
  Aprobada: 'hsl(var(--chart-2))',
  Rechazada: 'hsl(var(--destructive))',
};

export const CURRENCIES = [
  { value: 'MXN 🇲🇽', label: 'MXN ($)' },
  { value: 'USD 🇺🇸', label: 'USD ($)' },
  { value: 'EUR 🇪🇺', label: 'EUR (€)' },
];

export const COTIZ_CURRENCIES = [
  { value: 'MXN', label: 'MXN ($)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
];

export function getCurrencySymbol(currency?: string): string {
  if (currency?.startsWith('EUR')) return '€';
  return '$';
}

export function fmtMoney(amount?: number, symbol = '$'): string {
  if (amount == null) return '—';
  return `${symbol}${amount.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function fmtMoneyFull(amount?: number, symbol = '$'): string {
  if (amount == null) return '—';
  return `${symbol}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
