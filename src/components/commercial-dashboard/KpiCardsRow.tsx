import { useMemo } from 'react';
import { Deal, MetricKey, DashboardFilters, DateReference } from '@/lib/commercial-dashboard/types';
import { calcKpi, calcCurrencyBreakdown } from '@/lib/commercial-dashboard/metrics';
import { applyFilters, getPreviousPeriod } from '@/lib/commercial-dashboard/filters';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { fmtMetric } from './RankingTableWidget';

const KPI_DEFS: { metric: MetricKey; label: string; chartVar: string; wonOnly?: boolean }[] = [
  { metric: 'revenue', label: 'Revenue', chartVar: '--chart-1' },
  { metric: 'dealCount', label: 'Deals ganados', chartVar: '--chart-2', wonOnly: true },
  { metric: 'avgTicket', label: 'Ticket promedio', chartVar: '--chart-3' },
  { metric: 'conversionRate', label: 'Conversión', chartVar: '--chart-4' },
  { metric: 'margin', label: 'Margen bruto', chartVar: '--chart-5' },
];

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props {
  allDeals: Deal[];
  filters: DashboardFilters;
  dateRef: DateReference;
}

export default function KpiCardsRow({ allDeals, filters, dateRef }: Props) {
  const compareMode = filters.compareMode ?? 'previous';
  const current = useMemo(() => applyFilters(allDeals, filters, dateRef), [allDeals, filters, dateRef]);
  const prevPeriod = getPreviousPeriod(filters.period, compareMode);
  const previous = useMemo(
    () => prevPeriod ? applyFilters(allDeals, { ...filters, period: prevPeriod }, dateRef) : null,
    [allDeals, filters, dateRef, prevPeriod]
  );

  const currentWon = current.filter(d => d.phase === 'Ganado');
  const previousWon = previous ? previous.filter(d => d.phase === 'Ganado') : null;

  const breakdown = useMemo(() => calcCurrencyBreakdown(currentWon), [currentWon]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {KPI_DEFS.map(({ metric, label, chartVar, wonOnly }) => {
        const cur = wonOnly ? currentWon : current;
        const prev = wonOnly ? previousWon : previous;
        const { current: val, changePct } = calcKpi(cur, prev, metric);
        const up = (changePct ?? 0) >= 0;

        return (
          <div key={metric} className="bg-card border rounded-xl p-4 space-y-1">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold" style={{ color: `hsl(var(${chartVar}))` }}>
              {fmtMetric(val, metric)}
            </div>
            {changePct !== null ? (
              <div className={`flex items-center gap-1 text-xs font-medium ${up ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {up ? '+' : ''}{changePct.toFixed(1)}% {compareMode === 'yoy' ? 'YoY' : 'vs anterior'}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="w-3 h-3" /> Sin comparación
              </div>
            )}
            {metric === 'revenue' && breakdown.usdDealCount > 0 && (
              <div className="pt-0.5 space-y-0.5">
                <div className="text-[11px] text-muted-foreground leading-tight">
                  MXN {fmtCompact(breakdown.mxnNative)} + USD {fmtCompact(breakdown.usdNative)} (≈{fmtCompact(breakdown.usdConvertedToMxn)} MXN)
                </div>
                {breakdown.missingRates > 0 && (
                  <div className="text-[11px] text-yellow-600 dark:text-yellow-400 leading-tight">
                    ⚠ {breakdown.missingRates} sin TC
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
