import { ChartDataPoint } from '@/lib/commercial-dashboard/types';
import { PHASE_COLOR_MAP } from '@/components/commercial/dealUtils';

interface Props {
  data: ChartDataPoint[];
}

export default function FunnelWidget({ data }: Props) {
  const max = Math.max(...data.map(d => d.value), 1);
  const topValue = data[0]?.value ?? 1;
  if (data.length === 0) return <div className="text-center text-sm text-muted-foreground py-8">Sin datos</div>;

  return (
    <div className="space-y-1.5 py-2">
      {data.map(item => {
        const widthPct = Math.max((item.value / max) * 100, 8);
        const convPct = topValue > 0 ? ((item.value / topValue) * 100).toFixed(0) : '0';
        const color = PHASE_COLOR_MAP[item.label] ?? 'hsl(var(--primary))';
        return (
          <div key={item.label} className="flex items-center gap-2">
            <div className="w-28 text-xs text-right text-muted-foreground truncate shrink-0">{item.label}</div>
            <div className="flex-1 flex justify-center">
              <div
                className="flex items-center justify-center h-7 rounded text-xs font-semibold text-white transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
              >
                {item.value}
              </div>
            </div>
            <div className="w-10 text-xs text-muted-foreground text-right shrink-0">{convPct}%</div>
          </div>
        );
      })}
    </div>
  );
}
