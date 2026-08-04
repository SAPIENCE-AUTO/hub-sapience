import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { WidgetConfig, MetricKey, GroupByKey, ChartType, WidgetSize, Deal, DateReference } from '@/lib/commercial-dashboard/types';
import { METRIC_LABELS, GROUPBY_LABELS, CHART_TYPE_LABELS, VALID_GROUPBY_FOR_METRIC, getValidCharts, GROUPBY_CATEGORIES, COMPARE_DIMENSIONS } from '@/lib/commercial-dashboard/constants';
import { getGroupKey } from '@/lib/commercial-dashboard/grouping';
import ChartRenderer from './ChartRenderer';
import { BarChart3, TrendingUp, PieChart, Table2, Filter, Crosshair, CircleDot, type LucideIcon } from 'lucide-react';

const CHART_ICONS: Record<ChartType, LucideIcon> = {
  bar: BarChart3,
  line: TrendingUp,
  pie: PieChart,
  donut: CircleDot,
  rankingTable: Table2,
  funnel: Filter,
  scatter: Crosshair,
};

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: WidgetConfig | null;
  deals: Deal[];
  dateRef: DateReference;
  onSave: (w: WidgetConfig) => void;
}

function genId() { return `widget_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function getAvailableCompareValues(deals: Deal[], compareBy: GroupByKey, dateRef: DateReference): string[] {
  const seen = new Set<string>();
  for (const d of deals) {
    const v = getGroupKey(d, compareBy, dateRef);
    if (v && !v.startsWith('Sin ') && v !== 'Otro') seen.add(v);
  }
  if (compareBy === 'year') return [...seen].sort().reverse();
  return [...seen].sort();
}

const AUTO_LIMITS = [5, 8, 10, 15, 20];

export default function ChartBuilderModal({ open, onClose, initial, deals, dateRef, onSave }: Props) {
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [groupBy, setGroupBy] = useState<GroupByKey>('month');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [name, setName] = useState('');
  const [size, setSize] = useState<WidgetSize>('half');
  const [metricY, setMetricY] = useState<MetricKey>('dealCount');
  const [currency, setCurrency] = useState<'all' | 'MXN' | 'USD'>('all');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareBy, setCompareBy] = useState<GroupByKey>('year');
  const [compareMode, setCompareMode] = useState<'auto' | 'manual'>('auto');
  const [compareValues, setCompareValues] = useState<string[]>([]);
  const [autoLimit, setAutoLimit] = useState(10);

  useEffect(() => {
    if (open) {
      setMetric(initial?.metric ?? 'revenue');
      setGroupBy(initial?.groupBy ?? 'month');
      setChartType(initial?.chartType ?? 'bar');
      setName(initial?.name ?? '');
      setSize(initial?.size ?? 'half');
      setMetricY(initial?.metricY ?? 'dealCount');
      setCurrency(initial?.currency ?? 'all');
      setCompareEnabled(!!initial?.compareBy);
      setCompareBy(initial?.compareBy ?? 'year');
      setCompareMode(initial?.compareMode ?? 'auto');
      setCompareValues(initial?.compareValues ?? []);
      setAutoLimit(initial?.displayOptions?.limit ?? 10);
    }
  }, [open, initial]);

  const validGroupBys = VALID_GROUPBY_FOR_METRIC[metric];
  const validCharts = getValidCharts(metric, groupBy);
  const isScatter = chartType === 'scatter';
  const supportsCompare = (chartType === 'bar' || chartType === 'line') && !isScatter;
  const validCompareDimensions = COMPARE_DIMENSIONS.filter(d => d.key !== groupBy);

  const availableCompareValues = useMemo(
    () => getAvailableCompareValues(deals, compareBy, dateRef),
    [deals, compareBy, dateRef]
  );

  function onMetricChange(m: MetricKey) {
    setMetric(m);
    const vg = VALID_GROUPBY_FOR_METRIC[m];
    const newGb = vg.includes(groupBy) ? groupBy : vg[0];
    setGroupBy(newGb);
    const vc = getValidCharts(m, newGb);
    if (!vc.includes(chartType)) setChartType(vc[0]);
  }

  function onGroupByChange(g: GroupByKey) {
    setGroupBy(g);
    const vc = getValidCharts(metric, g);
    if (!vc.includes(chartType)) setChartType(vc[0]);
    if (g === compareBy) { setCompareEnabled(false); setCompareValues([]); }
  }

  function onCompareByChange(cb: GroupByKey) {
    setCompareBy(cb);
    setCompareValues([]);
  }

  function toggleCompareValue(val: string) {
    setCompareValues(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  }

  const previewWidget: WidgetConfig = {
    id: 'preview', name, metric, groupBy, chartType, size: 'full', filters: null,
    displayOptions: { limit: compareEnabled && supportsCompare ? autoLimit : 8, sortDirection: 'desc', showLegend: false },
    compareBy: compareEnabled && supportsCompare ? compareBy : undefined,
    compareValues: compareEnabled && supportsCompare && compareMode === 'manual' && compareValues.length > 0 ? compareValues : undefined,
    compareMode: compareEnabled && supportsCompare ? compareMode : undefined,
    metricY: isScatter ? metricY : undefined,
    currency,
  };

  function handleSave() {
    const shouldCompare = compareEnabled && supportsCompare;
    const displayOpts = shouldCompare
      ? { limit: autoLimit, sortDirection: 'desc' as const, showLegend: false }
      : (initial?.displayOptions ?? { limit: 8, sortDirection: 'desc' as const, showLegend: false });

    onSave({
      ...previewWidget,
      id: initial?.id ?? genId(),
      name: name.trim() || (isScatter
        ? `${METRIC_LABELS[metric]} vs ${METRIC_LABELS[metricY]} por ${GROUPBY_LABELS[groupBy]}`
        : `${METRIC_LABELS[metric]} por ${GROUPBY_LABELS[groupBy]}`),
      size,
      displayOptions: displayOpts,
      compareBy: shouldCompare ? compareBy : undefined,
      compareValues: shouldCompare && compareMode === 'manual' && compareValues.length > 0 ? compareValues : undefined,
      compareMode: shouldCompare ? compareMode : undefined,
      metricY: isScatter ? metricY : undefined,
      currency,
    });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
        <SheetHeader><SheetTitle>{initial ? 'Editar gráfica' : 'Agregar gráfica'}</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-5">

          {/* Sentence builder */}
          <div className="bg-muted/50 rounded-xl p-4 space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Configurar</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{isScatter ? 'Eje X' : 'Mostrar'}</span>
              <select value={metric} onChange={e => onMetricChange(e.target.value as MetricKey)}
                className="border rounded-md px-2 py-1 text-sm bg-background font-medium">
                {(Object.keys(METRIC_LABELS) as MetricKey[]).map(m => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
              </select>
              {isScatter && (
                <>
                  <span className="text-muted-foreground">Eje Y</span>
                  <select value={metricY} onChange={e => setMetricY(e.target.value as MetricKey)}
                    className="border rounded-md px-2 py-1 text-sm bg-background font-medium">
                    {(Object.keys(METRIC_LABELS) as MetricKey[]).map(m => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
                  </select>
                </>
              )}
              <span className="text-muted-foreground">por</span>
              <select value={groupBy} onChange={e => onGroupByChange(e.target.value as GroupByKey)}
                className="border rounded-md px-2 py-1 text-sm bg-background font-medium">
                {GROUPBY_CATEGORIES.map(cat => (
                  <optgroup key={cat.label} label={cat.label}>
                    {cat.keys.filter(k => validGroupBys.includes(k)).map(k => <option key={k} value={k}>{GROUPBY_LABELS[k]}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Currency picker */}
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">Moneda</p>
              <div className="flex gap-1.5">
                {([
                  { value: 'all', label: 'Todas (→MXN)' },
                  { value: 'MXN', label: 'Solo MXN' },
                  { value: 'USD', label: 'Solo USD' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setCurrency(opt.value)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      currency === opt.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border hover:bg-muted text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart type picker */}
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">Tipo de gráfica</p>
              <div className="flex flex-wrap gap-2">
                {validCharts.map(c => {
                  const Icon = CHART_ICONS[c];
                  const selected = chartType === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setChartType(c)}
                      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors min-w-[64px] ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border hover:bg-muted text-foreground'
                      }`}
                    >
                      <Icon size={18} />
                      {CHART_TYPE_LABELS[c]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Compare section */}
          {supportsCompare && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch checked={compareEnabled} onCheckedChange={v => { setCompareEnabled(v); if (!v) setCompareValues([]); }} />
                <Label className="cursor-pointer" onClick={() => setCompareEnabled(e => !e)}>
                  Comparar series
                </Label>
              </div>

              {compareEnabled && (
                <div className="bg-muted/40 border rounded-xl p-3 space-y-3">
                  {/* Dimension selector */}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Comparar por</span>
                    <select value={compareBy} onChange={e => onCompareByChange(e.target.value as GroupByKey)}
                      className="border rounded-md px-2 py-1 text-sm bg-background font-medium">
                      {validCompareDimensions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </div>

                  {/* Auto / Manual toggle */}
                  <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
                    {(['auto', 'manual'] as const).map(m => (
                      <button key={m} onClick={() => setCompareMode(m)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${compareMode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        {m === 'auto' ? '✦ Automático' : '✎ Manual'}
                      </button>
                    ))}
                  </div>

                  {/* Auto mode: pick top-N limit */}
                  {compareMode === 'auto' && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Mostrar top:</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {AUTO_LIMITS.map(n => (
                          <button key={n} onClick={() => setAutoLimit(n)}
                            className={`px-3 py-1 rounded-full text-xs border font-medium transition-colors ${autoLimit === n ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}>
                            {n}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground italic">
                        Seleccionará automáticamente los {autoLimit} {GROUPBY_LABELS[compareBy].toLowerCase()}s con mayor {METRIC_LABELS[metric].toLowerCase()}
                      </p>
                    </div>
                  )}

                  {/* Manual mode: chip picker, no limit */}
                  {compareMode === 'manual' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {compareValues.length > 0
                            ? <span className="text-primary font-medium">{compareValues.length} seleccionado(s)</span>
                            : 'Selecciona los valores a comparar'}
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => setCompareValues(availableCompareValues)}
                            className="text-xs text-primary hover:underline">Todos</button>
                          {compareValues.length > 0 && (
                            <button onClick={() => setCompareValues([])}
                              className="text-xs text-muted-foreground hover:underline">Limpiar</button>
                          )}
                        </div>
                      </div>
                      {availableCompareValues.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Sin valores disponibles</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                          {availableCompareValues.map(val => {
                            const selected = compareValues.includes(val);
                            return (
                              <button key={val} onClick={() => toggleCompareValue(val)}
                                className={`px-2.5 py-1 rounded-full text-xs border font-medium transition-colors ${selected ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted border-border'}`}>
                                {val}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          <div className="border rounded-xl p-3 bg-card">
            <p className="text-xs text-muted-foreground mb-2">Vista previa</p>
            <ChartRenderer widget={previewWidget} deals={deals.slice(0, 500)} dateRef={dateRef} />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={`${METRIC_LABELS[metric]} por ${GROUPBY_LABELS[groupBy]}`} />
          </div>

          {/* Size */}
          <div className="space-y-1.5">
            <Label>Tamaño</Label>
            <div className="flex gap-2">
              {(['half', 'full'] as WidgetSize[]).map(s => (
                <button key={s} onClick={() => setSize(s)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${size === s ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}>
                  {s === 'half' ? '½ Pantalla' : 'Completo'}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" onClick={handleSave}>{initial ? 'Guardar cambios' : 'Agregar gráfica'}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
