import { GetDealsOutputType } from 'zite-endpoints-sdk';

export type Deal = GetDealsOutputType['deals'][0];

export type MetricKey = 'revenue' | 'dealCount' | 'avgTicket' | 'margin' | 'cost' | 'conversionRate';
export type GroupByKey = 'month' | 'quarter' | 'year' | 'client' | 'projectType' | 'tematica' | 'owner' | 'empresaOperadora' | 'phase';
export type ChartType = 'bar' | 'line' | 'pie' | 'donut' | 'rankingTable' | 'funnel' | 'scatter';
export type WidgetSize = 'half' | 'full';
export type DateReference = 'proposalDate' | 'approvalDate';
export type PeriodMode = 'all' | 'year' | 'quarter' | 'month' | 'custom';
export type KpiCompareMode = 'previous' | 'yoy' | 'none';

export interface DashboardPeriod {
  mode: PeriodMode;
  year?: number;
  quarter?: number;
  month?: number;
  startDate?: string;
  endDate?: string;
}

export interface DashboardFilters {
  period: DashboardPeriod;
  clients: string[];
  projectTypes: string[];
  currencies: string[];
  owners: string[];
  empresaOperadora: string[];
  phases: string[];
  compareMode?: KpiCompareMode;
}

export interface WidgetDisplayOptions {
  limit?: number;
  sortDirection?: 'asc' | 'desc';
  showLegend?: boolean;
  showDataLabels?: boolean;
  stacked?: boolean;
}

export interface WidgetConfig {
  id: string;
  name: string;
  metric: MetricKey;
  groupBy: GroupByKey;
  chartType: ChartType;
  size: WidgetSize;
  filters: null;
  displayOptions: WidgetDisplayOptions;
  compareBy?: GroupByKey;
  compareValues?: string[];
  compareMode?: 'auto' | 'manual';
  metricY?: MetricKey;
  currency?: 'all' | 'MXN' | 'USD';
}

export interface SavedView {
  dbId: string;
  viewId: string;
  viewName: string;
  isDefault: boolean;
  isShared: boolean;
  filtersJson: string;
  widgetsJson: string;
  dateReference: DateReference;
  sortOrder: number;
}

export interface KpiResult {
  current: number;
  previous: number | null;
  changePct: number | null;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  valueY?: number;
  series?: Record<string, number>;
  deals?: Deal[];
}
