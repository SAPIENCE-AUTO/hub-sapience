import { MetricKey, GroupByKey, ChartType, DashboardFilters, WidgetConfig } from './types';

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Revenue',
  dealCount: '# Deals',
  avgTicket: 'Ticket promedio',
  margin: 'Margen bruto',
  cost: 'Costo cotizado',
  conversionRate: 'Tasa de conversión',
};

export const METRIC_IS_CURRENCY: Record<MetricKey, boolean> = {
  revenue: true,
  dealCount: false,
  avgTicket: true,
  margin: true,
  cost: true,
  conversionRate: false,
};

export const METRIC_IS_PERCENT: Record<MetricKey, boolean> = {
  revenue: false,
  dealCount: false,
  avgTicket: false,
  margin: false,
  cost: false,
  conversionRate: true,
};

export const GROUPBY_LABELS: Record<GroupByKey, string> = {
  month: 'Mes',
  quarter: 'Trimestre',
  year: 'Año',
  client: 'Cliente',
  projectType: 'Tipo de proyecto',
  tematica: 'Temática',
  owner: 'Owner',
  empresaOperadora: 'Empresa operadora',
  phase: 'Fase',
};

export const GROUPBY_CATEGORIES: { label: string; keys: GroupByKey[] }[] = [
  { label: 'Tiempo', keys: ['month', 'quarter', 'year'] },
  { label: 'Comercial', keys: ['client', 'owner', 'phase', 'empresaOperadora'] },
  { label: 'Proyecto', keys: ['projectType', 'tematica'] },
];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Barras',
  line: 'Línea',
  pie: 'Pie',
  donut: 'Donut',
  rankingTable: 'Ranking',
  funnel: 'Funnel',
  scatter: 'Dispersión',
};

export const VALID_GROUPBY_FOR_METRIC: Record<MetricKey, GroupByKey[]> = {
  revenue: ['month', 'quarter', 'year', 'client', 'projectType', 'tematica', 'owner', 'empresaOperadora', 'phase'],
  dealCount: ['month', 'quarter', 'year', 'client', 'projectType', 'tematica', 'owner', 'empresaOperadora', 'phase'],
  avgTicket: ['month', 'quarter', 'year', 'client', 'projectType', 'owner', 'empresaOperadora'],
  margin: ['month', 'quarter', 'year', 'client', 'projectType', 'tematica', 'owner', 'empresaOperadora'],
  cost: ['month', 'quarter', 'year', 'client', 'projectType', 'tematica', 'owner', 'empresaOperadora'],
  conversionRate: ['month', 'quarter', 'year', 'owner', 'empresaOperadora'],
};

const SCATTER_GROUPBY: GroupByKey[] = ['client', 'projectType', 'tematica', 'owner', 'empresaOperadora'];

export function getValidCharts(metric: MetricKey, groupBy: GroupByKey): ChartType[] {
  const isTime = ['month', 'quarter', 'year'].includes(groupBy);
  const isPhase = groupBy === 'phase';
  if (isPhase) return ['funnel', 'bar', 'pie'];
  if (isTime) return ['bar', 'line'];
  if (metric === 'conversionRate') return ['bar'];
  const supportsScatter = SCATTER_GROUPBY.includes(groupBy);
  return supportsScatter
    ? ['bar', 'rankingTable', 'pie', 'donut', 'scatter']
    : ['bar', 'rankingTable', 'pie', 'donut'];
}

export const COMPARE_DIMENSIONS: { key: GroupByKey; label: string }[] = [
  { key: 'month', label: 'Mes' },
  { key: 'quarter', label: 'Trimestre' },
  { key: 'year', label: 'Año' },
  { key: 'client', label: 'Cliente' },
  { key: 'owner', label: 'Owner' },
  { key: 'empresaOperadora', label: 'Empresa operadora' },
  { key: 'projectType', label: 'Tipo de proyecto' },
  { key: 'tematica', label: 'Temática' },
  { key: 'phase', label: 'Fase' },
];

export const PHASE_ORDER = [
  'Prospecto',
  'Brief recibido',
  'Cotización enviada',
  'Negociación',
  'Ganado',
  'Perdido',
];

export const DEFAULT_FILTERS: DashboardFilters = {
  period: { mode: 'all' },
  clients: [],
  projectTypes: [],
  currencies: [],
  owners: [],
  empresaOperadora: [],
  phases: [],
  compareMode: 'previous',
};

export const DEFAULT_DATE_REFERENCE = 'approvalDate' as const;

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  {
    id: 'widget_default_1',
    name: 'Revenue por mes',
    metric: 'revenue',
    groupBy: 'month',
    chartType: 'bar',
    size: 'full',
    filters: null,
    displayOptions: { showLegend: false, showDataLabels: false },
  },
  {
    id: 'widget_default_2',
    name: 'Funnel comercial',
    metric: 'dealCount',
    groupBy: 'phase',
    chartType: 'funnel',
    size: 'half',
    filters: null,
    displayOptions: { showDataLabels: true },
  },
  {
    id: 'widget_default_3',
    name: 'Revenue por cliente',
    metric: 'revenue',
    groupBy: 'client',
    chartType: 'rankingTable',
    size: 'half',
    filters: null,
    displayOptions: { limit: 10, sortDirection: 'desc' },
  },
  {
    id: 'widget_default_4',
    name: 'Deals por owner',
    metric: 'dealCount',
    groupBy: 'owner',
    chartType: 'bar',
    size: 'half',
    filters: null,
    displayOptions: { showDataLabels: true },
  },
  {
    id: 'widget_default_5',
    name: 'Margen por tipo de proyecto',
    metric: 'margin',
    groupBy: 'projectType',
    chartType: 'rankingTable',
    size: 'half',
    filters: null,
    displayOptions: { limit: 10, sortDirection: 'desc' },
  },
];
