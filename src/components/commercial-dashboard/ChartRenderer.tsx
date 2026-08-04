import { useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  ScatterChart, Scatter, ZAxis, CartesianGrid,
} from 'recharts';
import { Deal, WidgetConfig, DateReference } from '@/lib/commercial-dashboard/types';
import { METRIC_LABELS } from '@/lib/commercial-dashboard/constants';
import { buildChartData } from '@/lib/commercial-dashboard/chartData';
import RankingTableWidget, { fmtMetric } from './RankingTableWidget';
import FunnelWidget from './FunnelWidget';
import DrillDownSheet from './DrillDownSheet';

const COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
];

interface Props {
  widget: WidgetConfig;
  deals: Deal[];
  dateRef: DateReference;
}

export default function ChartRenderer({ widget, deals, dateRef }: Props) {
  const { chartType, metric, displayOptions, compareBy } = widget;
  const currency = widget.currency;
  const data = buildChartData(deals, widget, dateRef);
  const fmt = (v: number) => fmtMetric(v, metric, currency);
  const showLegend = displayOptions.showLegend ?? false;

  const [drillDown, setDrillDown] = useState<{ title: string; deals: Deal[] } | null>(null);

  function handleBarClick(entry: any) {
    if (!entry?.activePayload?.[0]) return;
    const label = entry.activePayload[0].payload?.label;
    const point = data.find(d => d.label === label);
    if (point?.deals?.length) {
      setDrillDown({ title: `${widget.name} — ${label}`, deals: point.deals });
    }
  }

  function handlePieClick(_: any, index: number) {
    const point = data[index];
    if (point?.deals?.length) {
      setDrillDown({ title: `${widget.name} — ${point.label}`, deals: point.deals });
    }
  }

  function handleScatterClick(entry: any) {
    const name = entry?.name;
    const point = data.find(d => d.label === name);
    if (point?.deals?.length) {
      setDrillDown({ title: `${widget.name} — ${name}`, deals: point.deals });
    }
  }

  const sheet = (
    <DrillDownSheet
      title={drillDown?.title ?? ''}
      deals={drillDown?.deals ?? []}
      open={!!drillDown}
      onClose={() => setDrillDown(null)}
    />
  );

  if (data.length === 0) return (
    <>
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Sin datos para el período seleccionado
      </div>
      {sheet}
    </>
  );

  // Multi-series mode (comparative)
  const isMultiSeries = !!(compareBy && data[0]?.series);
  if (isMultiSeries) {
    const seriesKeys = Object.keys(data[0].series!);
    const flatData = data.map(d => ({ label: d.label, ...d.series, _deals: d.deals }));
    const chartHeight = seriesKeys.length > 8 ? 280 : 240;
    const legendStyle = { fontSize: 11, maxHeight: 60, overflowY: 'auto' as const };

    if (chartType === 'line') {
      return (
        <>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={flatData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }} onClick={handleBarClick}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={legendStyle} />
              {seriesKeys.map((sk, i) => (
                <Line key={sk} type="monotone" dataKey={sk} stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2} dot={false} cursor="pointer" />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {sheet}
        </>
      );
    }

    // Grouped bar chart
    return (
      <>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={flatData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }} onClick={handleBarClick}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={legendStyle} />
            {seriesKeys.map((sk, i) => (
              <Bar key={sk} dataKey={sk} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} cursor="pointer" />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {sheet}
      </>
    );
  }

  // Scatter chart
  if (chartType === 'scatter') {
    const { metricY = 'dealCount' } = widget;
    const fmtY = (v: number) => fmtMetric(v, metricY, currency);
    const scatterData = data.map(d => ({ x: d.value, y: d.valueY ?? 0, name: d.label }));
    return (
      <>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 10, right: 20, left: 5, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="x" type="number" tickFormatter={fmt} tick={{ fontSize: 11 }} width={60}
              label={{ value: METRIC_LABELS[metric], position: 'insideBottom', offset: -12, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              dataKey="y" type="number" tickFormatter={fmtY} tick={{ fontSize: 11 }} width={60}
              label={{ value: METRIC_LABELS[metricY], angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <ZAxis range={[50, 50]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { x: number; y: number; name: string };
                return (
                  <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-md space-y-1">
                    <p className="font-semibold text-foreground">{p.name}</p>
                    <p className="text-muted-foreground">{METRIC_LABELS[metric]}: <span className="text-foreground font-medium">{fmt(p.x)}</span></p>
                    <p className="text-muted-foreground">{METRIC_LABELS[metricY]}: <span className="text-foreground font-medium">{fmtY(p.y)}</span></p>
                  </div>
                );
              }}
            />
            <Scatter data={scatterData} fill="hsl(var(--primary))" fillOpacity={0.8} cursor="pointer" onClick={handleScatterClick} />
          </ScatterChart>
        </ResponsiveContainer>
        {sheet}
      </>
    );
  }

  // Single-series mode (existing)
  if (chartType === 'rankingTable') return <>{<RankingTableWidget data={data} metric={metric} currency={currency} />}{sheet}</>;
  if (chartType === 'funnel') return <>{<FunnelWidget data={data} />}{sheet}</>;

  if (chartType === 'pie' || chartType === 'donut') {
    return (
      <>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
              innerRadius={chartType === 'donut' ? '45%' : 0} outerRadius="70%"
              cursor="pointer" onClick={handlePieClick}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmt(v)} />
            {showLegend && <Legend />}
          </PieChart>
        </ResponsiveContainer>
        {sheet}
      </>
    );
  }

  if (chartType === 'line') {
    return (
      <>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 5, bottom: 5 }} onClick={handleBarClick}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} />
            <Tooltip formatter={fmt} />
            <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} cursor="pointer" />
            {showLegend && <Legend />}
          </LineChart>
        </ResponsiveContainer>
        {sheet}
      </>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 5, bottom: 5 }} onClick={handleBarClick}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} />
          <Tooltip formatter={fmt} />
          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} cursor="pointer" />
          {showLegend && <Legend />}
        </BarChart>
      </ResponsiveContainer>
      {sheet}
    </>
  );
}
