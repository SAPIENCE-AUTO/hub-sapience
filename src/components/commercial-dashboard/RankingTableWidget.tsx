import { ChartDataPoint, MetricKey } from '@/lib/commercial-dashboard/types';
import { METRIC_IS_CURRENCY, METRIC_IS_PERCENT } from '@/lib/commercial-dashboard/constants';

export function fmtMetric(value: number, metric: MetricKey, currency?: 'all' | 'MXN' | 'USD'): string {
  const prefix = currency === 'USD' ? 'USD $' : '$';
  if (METRIC_IS_PERCENT[metric]) return `${(value * 100).toFixed(1)}%`;
  if (METRIC_IS_CURRENCY[metric]) {
    if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(0)}K`;
    return `${prefix}${value.toFixed(0)}`;
  }
  return value.toFixed(0);
}

interface Props {
  data: ChartDataPoint[];
  metric: MetricKey;
  currency?: 'all' | 'MXN' | 'USD';
}

export default function RankingTableWidget({ data, metric, currency }: Props) {
  const max = Math.max(...data.map(d => d.value), 1);
  if (data.length === 0) return <div className="text-center text-sm text-muted-foreground py-8">Sin datos</div>;
  return (
    <div className="space-y-2 p-1">
      {data.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm truncate">{item.label}</span>
              <span className="text-sm font-medium ml-2 shrink-0">{fmtMetric(item.value, metric, currency)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
