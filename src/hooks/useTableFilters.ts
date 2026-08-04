import { useState, useMemo, useCallback, useRef } from 'react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { FilterColumn, FilterRule } from '../components/AdvancedFilterSheet';

export type { FilterColumn, FilterRule };

export function useTableFilters<T extends object>(
  data: T[],
  columns: FilterColumn[]
) {
  const [columnFilters, setColumnFiltersState] = useState<Record<string, Set<string>>>({});
  const [advancedFilters, setAdvancedFilters] = useState<FilterRule[]>([]);
  const [filterMode, setFilterMode] = useState<'and' | 'or'>('and');
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const getField = (row: T, key: string): string =>
    String((row as Record<string, unknown>)[key] ?? '');

  /** Column type lookup map */
  const colTypeMap = useMemo(
    () => Object.fromEntries(columns.map(c => [c.key, c.type ?? 'text'])),
    [columns]
  );

  /** Unique sorted values for a column — always from the raw (unfiltered) data */
  const colUniqueValues = useCallback(
    (columnKey: string): string[] =>
      (() => {
        const all = data.map(row => getField(row, columnKey));
        const hasEmpty = all.some(v => !v.trim());
        const unique = [...new Set(all.filter(Boolean))].sort();
        if (hasEmpty) unique.push('');
        return unique;
      })(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  const setColFilter = useCallback((col: string, values: Set<string>) => {
    setColumnFiltersState(prev => {
      const next = { ...prev };
      if (values.size === 0) delete next[col];
      else next[col] = values;
      return next;
    });
  }, []);

  /** Toggle a column's visibility in hiddenColumns */
  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** 3-state sort cycle: none → asc → desc → none */
  const sortColumnRef = useRef(sortColumn);
  const sortDirectionRef = useRef(sortDirection);
  sortColumnRef.current = sortColumn;
  sortDirectionRef.current = sortDirection;

  const toggleSort = useCallback((columnKey: string) => {
    const col = sortColumnRef.current;
    const dir = sortDirectionRef.current;
    if (col !== columnKey) {
      setSortColumn(columnKey);
      setSortDirection('asc');
    } else if (dir === 'asc') {
      setSortDirection('desc');
    } else {
      setSortColumn(null);
      setSortDirection('asc');
    }
  }, []);

  /** Reset all filters. Does NOT reset hiddenColumns — column visibility is a separate preference. */
  const clearAllFilters = useCallback(() => {
    setColumnFiltersState({});
    setAdvancedFilters([]);
    setFilterMode('and');
    setSortColumn(null);
    setSortDirection('asc');
  }, []);

  /**
   * Apply a full view config from a filtersJson string.
   * Parses { filterRules, filterMode, columnFilters, hiddenColumns, sortColumn, sortDirection } and applies all at once.
   */
  const applyViewFilters = useCallback((filtersJson: string) => {
    try {
      const parsed = JSON.parse(filtersJson) as {
        filterRules?: FilterRule[];
        filterMode?: 'and' | 'or';
        columnFilters?: Record<string, string[]>;
        hiddenColumns?: string[];
        sortColumn?: string | null;
        sortDirection?: 'asc' | 'desc';
      };

      setAdvancedFilters(parsed.filterRules ?? []);
      setFilterMode(parsed.filterMode ?? 'and');

      const rebuilt: Record<string, Set<string>> = {};
      for (const [col, vals] of Object.entries(parsed.columnFilters ?? {})) {
        if (vals.length > 0) rebuilt[col] = new Set(vals);
      }
      setColumnFiltersState(rebuilt);
      setHiddenColumns(new Set(parsed.hiddenColumns ?? []));
      setSortColumn(parsed.sortColumn ?? null);
      setSortDirection(parsed.sortDirection ?? 'asc');
    } catch {
      setAdvancedFilters([]);
      setFilterMode('and');
      setColumnFiltersState({});
      setHiddenColumns(new Set());
      setSortColumn(null);
      setSortDirection('asc');
    }
  }, []);

  /**
   * Serialize current filter + column visibility + sort state to a filtersJson string (for saving a view).
   */
  const serializeFilters = useCallback(
    (
      rules: FilterRule[],
      mode: 'and' | 'or',
      colFilters: Record<string, Set<string>>,
      hidden: Set<string>,
      sc: string | null,
      sd: 'asc' | 'desc'
    ): string => {
      const columnFiltersSerializable: Record<string, string[]> = {};
      for (const [col, vals] of Object.entries(colFilters)) {
        columnFiltersSerializable[col] = [...vals];
      }
      return JSON.stringify({
        filterRules: rules,
        filterMode: mode,
        columnFilters: columnFiltersSerializable,
        hiddenColumns: [...hidden],
        sortColumn: sc,
        sortDirection: sd,
      });
    },
    []
  );

  const activeFilterCount = useMemo(
    () => Object.values(columnFilters).filter(s => s.size > 0).length + advancedFilters.length,
    [columnFilters, advancedFilters]
  );

  /** Evaluate a single rule against a row */
  const matchesRule = useCallback((row: T, rule: FilterRule): boolean => {
    const colType = colTypeMap[rule.column] ?? 'text';
    const rawVal = getField(row, rule.column);

    if (rule.operator === 'vacio')    return !rawVal.trim();
    if (rule.operator === 'no_vacio') return !!rawVal.trim();

    if (colType === 'number') {
      const numVal = parseFloat(rawVal);
      const numRv  = parseFloat(rule.value);
      if (isNaN(numVal)) return false;
      switch (rule.operator) {
        case 'igual_a':     return numVal === numRv;
        case 'no_igual_a':  return numVal !== numRv;
        case 'mayor_que':   return numVal > numRv;
        case 'menor_que':   return numVal < numRv;
        case 'mayor_igual': return numVal >= numRv;
        case 'menor_igual': return numVal <= numRv;
        case 'entre':       return numVal >= numRv && numVal <= parseFloat(rule.value2 ?? '');
        default:            return true;
      }
    }

    if (colType === 'date') {
      switch (rule.operator) {
        case 'fecha_es':    return rawVal.slice(0, 10) === rule.value.slice(0, 10);
        case 'antes_de':    return new Date(rawVal) < new Date(rule.value);
        case 'despues_de':  return new Date(rawVal) > new Date(rule.value);
        case 'entre': {
          const d = new Date(rawVal);
          return d >= new Date(rule.value) && d <= new Date(rule.value2 ?? '');
        }
        case 'esta_semana': {
          const d = new Date(rawVal);
          const now = new Date();
          return d >= startOfWeek(now, { weekStartsOn: 1 }) && d <= endOfWeek(now, { weekStartsOn: 1 });
        }
        case 'este_mes': {
          const d = new Date(rawVal);
          const now = new Date();
          return d >= startOfMonth(now) && d <= endOfMonth(now);
        }
        default: return true;
      }
    }

    if (colType === 'select') {
      const selVals = rule.selectedValues?.length ? rule.selectedValues : [rule.value];
      switch (rule.operator) {
        case 'es':            return rawVal === rule.value;
        case 'no_es':         return rawVal !== rule.value;
        case 'es_alguno':     return selVals.includes(rawVal);
        case 'no_es_ninguno': return !selVals.includes(rawVal);
        default:              return true;
      }
    }

    // text
    const val = rawVal.toLowerCase();
    const textVals = (rule.selectedValues?.length ? rule.selectedValues : rule.value ? [rule.value] : [])
      .map(v => v.toLowerCase());
    if (textVals.length === 0) return true;
    switch (rule.operator) {
      case 'contiene':    return textVals.some(rv => val.includes(rv));
      case 'no_contiene': return textVals.every(rv => !val.includes(rv));
      case 'igual_a':     return textVals.some(rv => val === rv);
      case 'no_igual_a':  return textVals.every(rv => val !== rv);
      case 'empieza_con': return textVals.some(rv => val.startsWith(rv));
      case 'termina_con': return textVals.some(rv => val.endsWith(rv));
      default:            return true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colTypeMap]);

  /** Returns true if a rule has enough values to be evaluated */
  const ruleIsReady = (rule: FilterRule): boolean => {
    const noVal = ['vacio', 'no_vacio', 'esta_semana', 'este_mes'].includes(rule.operator);
    if (noVal) return true;
    if (rule.operator === 'entre') return !!rule.value && !!rule.value2;
    if (['es_alguno', 'no_es_ninguno'].includes(rule.operator)) return (rule.selectedValues?.length ?? 0) > 0;
    if (['contiene', 'no_contiene', 'igual_a', 'empieza_con', 'termina_con'].includes(rule.operator))
      return (rule.selectedValues?.length ?? 0) > 0 || !!rule.value;
    return !!rule.value;
  };

  /** Data with all filters applied */
  const filteredData = useMemo(() => {
    const hasColumnFilters = Object.values(columnFilters).some(s => s.size > 0);
    const readyRules = advancedFilters.filter(r => r.column && r.operator && ruleIsReady(r));
    if (!hasColumnFilters && readyRules.length === 0) return data;

    let result = data;

    for (const [col, values] of Object.entries(columnFilters)) {
      if (values.size === 0) continue;
      result = result.filter(r => values.has(getField(r, col)));
    }

    if (readyRules.length > 0) {
      if (filterMode === 'or') {
        result = result.filter(row => readyRules.some(rule => matchesRule(row, rule)));
      } else {
        result = result.filter(row => readyRules.every(rule => matchesRule(row, rule)));
      }
    }

    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, columnFilters, advancedFilters, filterMode, matchesRule]);

  return {
    filteredData,
    columnFilters,
    setColumnFiltersState,
    advancedFilters,
    setAdvancedFilters,
    filterMode,
    setFilterMode,
    setColFilter,
    clearAllFilters,
    applyViewFilters,
    serializeFilters,
    colUniqueValues,
    activeFilterCount,
    columns,
    hiddenColumns,
    setHiddenColumns,
    toggleColumn,
    sortColumn,
    sortDirection,
    setSortColumn,
    setSortDirection,
    toggleSort,
  };
}
