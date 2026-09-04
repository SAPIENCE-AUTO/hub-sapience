import { Deal, GroupByKey, DateReference } from './types';
import { PHASE_ORDER } from './constants';
import { getEffectiveDate } from './filters';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function getDateKey(d: Deal, dateRef: DateReference, groupBy: 'month' | 'quarter' | 'year'): string {
  const dateStr = getEffectiveDate(d, dateRef);
  if (!dateStr) return 'Sin fecha';
  const [y, m] = dateStr.split('-').map(Number);
  if (groupBy === 'year') return `${y}`;
  if (groupBy === 'quarter') return `Q${Math.ceil(m / 3)} ${y}`;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function getDateSortKey(d: Deal, dateRef: DateReference): string {
  return getEffectiveDate(d, dateRef) ?? '0000-00';
}

export function getGroupKey(d: Deal, groupBy: GroupByKey, dateRef: DateReference): string {
  switch (groupBy) {
    case 'month':
    case 'quarter':
    case 'year':
      return getDateKey(d, dateRef, groupBy);
    case 'client': return d.client ?? 'Sin cliente';
    case 'projectType': return d.projectType ?? 'Sin tipo';
    case 'tematica': return d.tematica ?? 'Sin temática';
    case 'owner': {
      const arr = Array.isArray(d.owner) ? d.owner : d.owner ? [d.owner] : [];
      return arr[0] ?? 'Sin owner';
    }
    case 'empresaOperadora': return d.empresaOperadora ?? 'Sin empresa';
    case 'phase': return d.phase ?? 'Sin fase';
    default: return 'Otro';
  }
}

/** Returns just the time unit label without the year (e.g. "Ene" instead of "Ene 2024"). Used for year-comparison charts. */
export function getGroupKeyStripped(d: Deal, groupBy: GroupByKey, dateRef: DateReference): string {
  if (groupBy === 'month' || groupBy === 'quarter') {
    const dateStr = getEffectiveDate(d, dateRef);
    if (!dateStr) return 'Sin fecha';
    const [, m] = dateStr.split('-').map(Number);
    if (groupBy === 'month') return MONTH_NAMES[m - 1];
    return `Q${Math.ceil(m / 3)}`;
  }
  return getGroupKey(d, groupBy, dateRef);
}

export function groupDeals(deals: Deal[], groupBy: GroupByKey, dateRef: DateReference): Map<string, Deal[]> {
  const map = new Map<string, Deal[]>();
  for (const d of deals) {
    const key = getGroupKey(d, groupBy, dateRef);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }

  // Sort phase by canonical order
  if (groupBy === 'phase') {
    const sorted = new Map<string, Deal[]>();
    for (const p of PHASE_ORDER) {
      if (map.has(p)) sorted.set(p, map.get(p)!);
    }
    for (const [k, v] of map) {
      if (!sorted.has(k)) sorted.set(k, v);
    }
    return sorted;
  }

  // Sort time-based chronologically using a representative deal's date
  if (['month', 'quarter', 'year'].includes(groupBy)) {
    const keyToSortVal = new Map<string, string>();
    for (const d of deals) {
      const key = getGroupKey(d, groupBy, dateRef);
      if (!keyToSortVal.has(key)) {
        keyToSortVal.set(key, getDateSortKey(d, dateRef));
      }
    }
    const entries = [...map.entries()].sort((a, b) =>
      (keyToSortVal.get(a[0]) ?? '').localeCompare(keyToSortVal.get(b[0]) ?? '')
    );
    return new Map(entries);
  }

  return map;
}

export function fillTimeSeries(
  data: Map<string, Deal[]>,
  groupBy: 'month' | 'quarter' | 'year',
  deals: Deal[],
  dateRef: DateReference
): Map<string, Deal[]> {
  const dates = deals
    .map(d => getEffectiveDate(d, dateRef))
    .filter((s): s is string => !!s)
    .sort();
  if (dates.length === 0) return data;

  const [minY, minM] = dates[0].split('-').map(Number);
  const [maxY, maxM] = dates[dates.length - 1].split('-').map(Number);
  const filled = new Map<string, Deal[]>();

  if (groupBy === 'year') {
    for (let y = minY; y <= maxY; y++) {
      const k = `${y}`;
      filled.set(k, data.get(k) ?? []);
    }
  } else if (groupBy === 'quarter') {
    let y = minY, q = Math.ceil(minM / 3);
    const ey = maxY, eq = Math.ceil(maxM / 3);
    while (y < ey || (y === ey && q <= eq)) {
      const k = `Q${q} ${y}`;
      filled.set(k, data.get(k) ?? []);
      if (++q > 4) { q = 1; y++; }
    }
  } else {
    let y = minY, m = minM - 1; // convert to 0-based month index
    const ey = maxY, em = maxM - 1;
    while (y < ey || (y === ey && m <= em)) {
      const k = `${MONTH_NAMES[m]} ${y}`;
      filled.set(k, data.get(k) ?? []);
      if (++m > 11) { m = 0; y++; }
    }
  }
  return filled;
}
