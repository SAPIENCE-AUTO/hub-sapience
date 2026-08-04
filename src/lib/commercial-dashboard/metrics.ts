import { Deal, MetricKey } from './types';
import { DashboardPeriod } from './types';
import { getPreviousPeriod } from './filters';

function toMXN(deal: Deal): { revenue: number; cost: number } {
  const isMXN = deal.currency?.startsWith('MXN');
  const rate = isMXN ? 1 : (deal.exchangeRate ?? 20);
  return {
    revenue: (deal.clientPrice ?? 0) * rate,
    cost: (deal.quotedCost ?? 0) * rate,
  };
}

export function calcCurrencyBreakdown(deals: Deal[]) {
  let mxnNative = 0;
  let usdNative = 0;
  let usdConvertedToMxn = 0;
  let missingRates = 0;
  let usdDealCount = 0;

  for (const d of deals) {
    const price = d.clientPrice ?? 0;
    const isMXN = d.currency?.startsWith('MXN');
    if (isMXN || !d.currency) {
      mxnNative += price;
    } else {
      usdDealCount++;
      usdNative += price;
      if (!d.exchangeRate) missingRates++;
      usdConvertedToMxn += price * (d.exchangeRate ?? 20);
    }
  }

  return {
    mxnNative,
    usdNative,
    usdConvertedToMxn,
    avgRate: usdNative > 0 ? usdConvertedToMxn / usdNative : 0,
    totalMxn: mxnNative + usdConvertedToMxn,
    usdDealCount,
    missingRates,
  };
}

export function calcRevenue(deals: Deal[]): number {
  return deals.reduce((s, d) => s + toMXN(d).revenue, 0);
}

export function calcCost(deals: Deal[]): number {
  return deals.reduce((s, d) => s + toMXN(d).cost, 0);
}

export function calcMargin(deals: Deal[]): number {
  return calcRevenue(deals) - calcCost(deals);
}

export function calcAvgTicket(deals: Deal[]): number {
  const withPrice = deals.filter(d => (d.clientPrice ?? 0) > 0);
  if (withPrice.length === 0) return 0;
  return calcRevenue(withPrice) / withPrice.length;
}

export function calcConversionRate(deals: Deal[]): number {
  const base = deals.filter(d =>
    ['Cotización enviada', 'Negociación', 'Ganado', 'Perdido'].includes(d.phase ?? '')
  );
  if (base.length === 0) return 0;
  return base.filter(d => d.phase === 'Ganado').length / base.length;
}

export function calcMetric(deals: Deal[], metric: MetricKey): number {
  switch (metric) {
    case 'revenue': return calcRevenue(deals);
    case 'cost': return calcCost(deals);
    case 'margin': return calcMargin(deals);
    case 'avgTicket': return calcAvgTicket(deals);
    case 'dealCount': return deals.length;
    case 'conversionRate': return calcConversionRate(deals);
    default: return 0;
  }
}

/** Filter deals by a widget-level currency preference */
export function filterDealsByCurrency(deals: Deal[], currency?: 'all' | 'MXN' | 'USD'): Deal[] {
  if (!currency || currency === 'all') return deals;
  return deals.filter(d => d.currency?.startsWith(currency));
}

/**
 * Calculate a metric with optional currency filtering.
 * - 'all' / undefined: uses toMXN() conversion (existing behavior)
 * - 'MXN' or 'USD': uses clientPrice / quotedCost directly, no conversion
 * Note: deals should already be pre-filtered by filterDealsByCurrency before calling this.
 */
export function calcMetricInCurrency(deals: Deal[], metric: MetricKey, currency?: 'all' | 'MXN' | 'USD'): number {
  if (!currency || currency === 'all') return calcMetric(deals, metric);
  // Specific currency — use raw amounts without exchange-rate conversion
  switch (metric) {
    case 'revenue': return deals.reduce((s, d) => s + (d.clientPrice ?? 0), 0);
    case 'cost': return deals.reduce((s, d) => s + (d.quotedCost ?? 0), 0);
    case 'margin': return deals.reduce((s, d) => s + (d.clientPrice ?? 0) - (d.quotedCost ?? 0), 0);
    case 'avgTicket': {
      const w = deals.filter(d => (d.clientPrice ?? 0) > 0);
      return w.length === 0 ? 0 : w.reduce((s, d) => s + (d.clientPrice ?? 0), 0) / w.length;
    }
    case 'dealCount': return deals.length;
    case 'conversionRate': return calcConversionRate(deals);
    default: return 0;
  }
}

export function calcKpi(
  current: Deal[],
  previous: Deal[] | null,
  metric: MetricKey
): { current: number; previous: number | null; changePct: number | null } {
  const cur = calcMetric(current, metric);
  const prev = previous !== null ? calcMetric(previous, metric) : null;
  const changePct =
    prev !== null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  return { current: cur, previous: prev, changePct };
}

export function hasPreviousPeriod(period: DashboardPeriod): boolean {
  return getPreviousPeriod(period) !== null;
}
