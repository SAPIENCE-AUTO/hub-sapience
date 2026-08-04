import { Deal, WidgetConfig, ChartDataPoint, DateReference } from './types';
import { calcMetricInCurrency, filterDealsByCurrency } from './metrics';
import { groupDeals, fillTimeSeries, getGroupKey, getGroupKeyStripped } from './grouping';

const MONTH_NAMES_ORDERED = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const QUARTER_NAMES_ORDERED = ['Q1', 'Q2', 'Q3', 'Q4'];

export function buildChartData(
  deals: Deal[],
  widget: WidgetConfig,
  dateRef: DateReference
): ChartDataPoint[] {
  // Pre-filter deals by the widget's currency preference
  const filteredDeals = filterDealsByCurrency(deals, widget.currency);

  if (widget.chartType === 'scatter') {
    return buildScatterData(filteredDeals, widget, dateRef);
  }
  const { compareBy: cb } = widget;
  if (cb && cb !== widget.groupBy) {
    return buildMultiSeriesData(filteredDeals, widget, dateRef, deals);
  }
  return buildSingleSeriesData(filteredDeals, widget, dateRef, deals);
}

function buildScatterData(deals: Deal[], widget: WidgetConfig, dateRef: DateReference): ChartDataPoint[] {
  const { metric, metricY, groupBy, displayOptions, currency } = widget;
  const grouped = groupDeals(deals, groupBy, dateRef);
  const points: ChartDataPoint[] = [];
  for (const [label, grpDeals] of grouped.entries()) {
    if (!label || label.startsWith('Sin ')) continue;
    points.push({
      label,
      value: calcMetricInCurrency(grpDeals, metric, currency),
      valueY: calcMetricInCurrency(grpDeals, metricY ?? 'dealCount', currency),
      deals: grpDeals,
    });
  }
  const dir = displayOptions.sortDirection ?? 'desc';
  points.sort((a, b) => dir === 'desc' ? b.value - a.value : a.value - b.value);
  return points.slice(0, displayOptions.limit ?? 50);
}

function buildSingleSeriesData(deals: Deal[], widget: WidgetConfig, dateRef: DateReference, allDeals?: Deal[]): ChartDataPoint[] {
  const { metric, groupBy, displayOptions, currency } = widget;
  const isTime = ['month', 'quarter', 'year'].includes(groupBy);

  let grouped = groupDeals(deals, groupBy, dateRef);
  if (isTime) grouped = fillTimeSeries(grouped, groupBy as 'month' | 'quarter' | 'year', allDeals ?? deals, dateRef);

  const points: ChartDataPoint[] = [...grouped.entries()].map(([label, grpDeals]) => ({
    label,
    value: calcMetricInCurrency(grpDeals, metric, currency),
    deals: grpDeals,
  }));

  if (!isTime && groupBy !== 'phase') {
    const dir = displayOptions.sortDirection ?? 'desc';
    points.sort((a, b) => dir === 'desc' ? b.value - a.value : a.value - b.value);
    return points.slice(0, displayOptions.limit ?? 50);
  }
  return points;
}

/** Auto-detect the top N compare values by total metric across all deals */
function getAutoCompareValues(
  deals: Deal[],
  compareBy: string,
  metric: WidgetConfig['metric'],
  dateRef: DateReference,
  limit: number,
  currency?: 'all' | 'MXN' | 'USD'
): string[] {
  const totals = new Map<string, number>();
  for (const d of deals) {
    const cv = getGroupKey(d, compareBy as any, dateRef);
    if (!cv || cv.startsWith('Sin ') || cv === 'Otro') continue;
    totals.set(cv, (totals.get(cv) ?? 0));
  }
  // compute metric per value
  for (const cv of totals.keys()) {
    const subset = deals.filter(d => getGroupKey(d, compareBy as any, dateRef) === cv);
    totals.set(cv, calcMetricInCurrency(subset, metric, currency));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cv]) => cv);
}

function buildMultiSeriesData(deals: Deal[], widget: WidgetConfig, dateRef: DateReference, allDeals?: Deal[]): ChartDataPoint[] {
  const { metric, groupBy, compareBy, compareValues, compareMode, displayOptions, currency } = widget;
  const isTimeGroupBy = ['month', 'quarter', 'year'].includes(groupBy);
  const isTimeCompare = ['month', 'quarter', 'year'].includes(compareBy!);
  const seriesLimit = displayOptions.limit ?? 10;

  // Resolve which compare values to use.
  const isAuto = compareMode === 'auto' || !compareValues?.length;
  const resolvedValues = isAuto
    ? getAutoCompareValues(deals, compareBy!, metric, dateRef, isTimeCompare ? 100 : seriesLimit, currency)
    : compareValues!;

  if (resolvedValues.length === 0) return buildSingleSeriesData(deals, widget, dateRef, allDeals);

  // Case A: compareBy=year, groupBy=month/quarter → strip year from x-axis labels
  const useStripped = compareBy === 'year' && (groupBy === 'month' || groupBy === 'quarter');

  // Case B: compareBy is temporal (month/quarter/year), groupBy is non-temporal
  const timeCompareNonTimeGroup = isTimeCompare && !isTimeGroupBy;

  // Establish ordered x-axis labels
  let labels: string[];
  if (useStripped) {
    labels = groupBy === 'month' ? MONTH_NAMES_ORDERED : QUARTER_NAMES_ORDERED;
  } else if (timeCompareNonTimeGroup) {
    const labelSet = new Set<string>();
    for (const d of deals) {
      const lbl = getGroupKey(d, groupBy, dateRef);
      if (lbl && !lbl.startsWith('Sin ')) labelSet.add(lbl);
    }
    labels = [...labelSet];
  } else if (isTimeGroupBy) {
    const allGrouped = groupDeals(allDeals ?? deals, groupBy, dateRef);
    const filled = fillTimeSeries(allGrouped, groupBy as 'month' | 'quarter' | 'year', allDeals ?? deals, dateRef);
    labels = [...filled.keys()];
  } else {
    const labelSet = new Set<string>();
    for (const d of deals) {
      const lbl = getGroupKey(d, groupBy, dateRef);
      if (lbl) labelSet.add(lbl);
    }
    labels = [...labelSet];
  }

  // For each series value: compute metric per x-axis label
  const seriesData: { cv: string; byLabel: Map<string, number> }[] = [];
  for (const cv of resolvedValues) {
    const filtered = deals.filter(d => getGroupKey(d, compareBy!, dateRef) === cv);
    const byLabel = new Map<string, number>();

    if (useStripped) {
      const strippedGroups = new Map<string, Deal[]>();
      for (const d of filtered) {
        const k = getGroupKeyStripped(d, groupBy, dateRef);
        if (!strippedGroups.has(k)) strippedGroups.set(k, []);
        strippedGroups.get(k)!.push(d);
      }
      for (const lbl of labels) {
        byLabel.set(lbl, calcMetricInCurrency(strippedGroups.get(lbl) ?? [], metric, currency));
      }
    } else if (timeCompareNonTimeGroup) {
      const grouped = groupDeals(filtered, groupBy, dateRef);
      for (const lbl of labels) {
        byLabel.set(lbl, calcMetricInCurrency(grouped.get(lbl) ?? [], metric, currency));
      }
    } else {
      const grouped = groupDeals(filtered, groupBy, dateRef);
      for (const [lbl, ds] of grouped.entries()) {
        byLabel.set(lbl, calcMetricInCurrency(ds, metric, currency));
      }
    }
    seriesData.push({ cv, byLabel });
  }

  // For non-time x-axis: sort labels by combined value and apply seriesLimit
  if (!isTimeGroupBy && groupBy !== 'phase') {
    const combined = labels.map(lbl => ({
      lbl,
      total: seriesData.reduce((s, sd) => s + (sd.byLabel.get(lbl) ?? 0), 0),
    }));
    const dir = displayOptions.sortDirection ?? 'desc';
    combined.sort((a, b) => dir === 'desc' ? b.total - a.total : a.total - b.total);
    labels = combined.slice(0, seriesLimit).map(x => x.lbl);
  }

  // Collect deals per label across all series
  const dealsByLabel = new Map<string, Deal[]>();
  for (const cv of resolvedValues) {
    const filtered = deals.filter(d => getGroupKey(d, compareBy!, dateRef) === cv);
    for (const d of filtered) {
      const lbl = useStripped
        ? getGroupKeyStripped(d, groupBy, dateRef)
        : getGroupKey(d, groupBy, dateRef);
      if (labels.includes(lbl)) {
        if (!dealsByLabel.has(lbl)) dealsByLabel.set(lbl, []);
        dealsByLabel.get(lbl)!.push(d);
      }
    }
  }

  return labels.map(label => ({
    label,
    value: 0,
    series: Object.fromEntries(seriesData.map(({ cv, byLabel }) => [cv, byLabel.get(label) ?? 0])),
    deals: dealsByLabel.get(label) ?? [],
  }));
}
