export function fmtCurrency(amount?: number, currency?: string): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Un proyecto sin status capturado (ej. INSANITY: status null en BD) se
// trata como "En curso" — el default real de negocio. Comparar
// `status === 'En curso'` directo, sin este fallback, hace que un status
// vacío/null caiga del lado "inactivo" en cualquier filtro que use esa
// comparación (confirmado: pasaba independientemente en ChatPage.tsx,
// Layout.tsx, ProjectCards.tsx y getDashboardData.ts — mismo bug, cuatro
// lugares distintos).
export function isActiveProjectStatus(status?: string | null): boolean {
  return !status || status === 'En curso';
}
