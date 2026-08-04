import { Deal, DashboardFilters, DateReference, DashboardPeriod, KpiCompareMode } from './types';

export function getPeriodRange(period: DashboardPeriod): { startDate: string | null; endDate: string | null } {
  if (period.mode === 'all') return { startDate: null, endDate: null };
  if (period.mode === 'custom') {
    return { startDate: period.startDate ?? null, endDate: period.endDate ?? null };
  }

  const year = period.year ?? new Date().getFullYear();

  if (period.mode === 'year') {
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  if (period.mode === 'quarter' && period.quarter) {
    const starts = ['01', '04', '07', '10'];
    const ends = ['03-31', '06-30', '09-30', '12-31'];
    return {
      startDate: `${year}-${starts[period.quarter - 1]}-01`,
      endDate: `${year}-${ends[period.quarter - 1]}`,
    };
  }
  if (period.mode === 'month' && period.month) {
    const m = String(period.month).padStart(2, '0');
    const lastDay = new Date(year, period.month, 0).getDate();
    return {
      startDate: `${year}-${m}-01`,
      endDate: `${year}-${m}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  return { startDate: null, endDate: null };
}

export function getPreviousPeriod(period: DashboardPeriod, compareMode: KpiCompareMode = 'previous'): DashboardPeriod | null {
  if (compareMode === 'none') return null;
  if (period.mode === 'all' || period.mode === 'custom') return null;
  const year = period.year ?? new Date().getFullYear();

  if (compareMode === 'yoy') {
    if (period.mode === 'year') return { mode: 'year', year: year - 1 };
    if (period.mode === 'quarter' && period.quarter) {
      return { mode: 'quarter', year: year - 1, quarter: period.quarter };
    }
    if (period.mode === 'month' && period.month) {
      return { mode: 'month', year: year - 1, month: period.month };
    }
    return null;
  }

  // compareMode === 'previous'
  if (period.mode === 'year') return { mode: 'year', year: year - 1 };
  if (period.mode === 'quarter' && period.quarter) {
    return period.quarter === 1
      ? { mode: 'quarter', year: year - 1, quarter: 4 }
      : { mode: 'quarter', year, quarter: period.quarter - 1 };
  }
  if (period.mode === 'month' && period.month) {
    return period.month === 1
      ? { mode: 'month', year: year - 1, month: 12 }
      : { mode: 'month', year, month: period.month - 1 };
  }
  return null;
}

export function applyFilters(deals: Deal[], filters: DashboardFilters, dateRef: DateReference): Deal[] {
  const { startDate, endDate } = getPeriodRange(filters.period);

  return deals.filter(d => {
    if (startDate || endDate) {
      const dateStr = dateRef === 'approvalDate' ? d.approvalDate : d.proposalDate;
      if (!dateStr) return false;
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;
    }
    if (filters.clients.length > 0 && !filters.clients.includes(d.client ?? '')) return false;
    if (filters.projectTypes.length > 0 && !filters.projectTypes.includes(d.projectType ?? '')) return false;
    if (filters.currencies.length > 0 && !filters.currencies.includes(d.currency ?? '')) return false;
    if (filters.phases.length > 0 && !filters.phases.includes(d.phase ?? '')) return false;
    if (filters.owners.length > 0) {
      const ownerArr = Array.isArray(d.owner) ? d.owner : d.owner ? [d.owner] : [];
      if (!filters.owners.some(o => ownerArr.includes(o))) return false;
    }
    if (filters.empresaOperadora.length > 0) {
      const emp = d.empresaOperadora ?? '';
      if (!filters.empresaOperadora.includes(emp)) return false;
    }
    return true;
  });
}
