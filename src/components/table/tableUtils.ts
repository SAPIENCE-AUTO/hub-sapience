import { useState, useRef } from 'react';
import type { DynColumn, DynCellValue } from '../../hooks/useDynamicColumns';
import type { FilterColumn } from '../AdvancedFilterSheet';
import { formatAddressText } from '../DynamicColumns';

export const GROUP_COLORS = [
  // Rojo
  { id: 'red-1', label: 'Rojo claro',   color: 'hsl(var(--group-red-1))' },
  { id: 'red-2', label: 'Rojo',         color: 'hsl(var(--group-red-2))' },
  { id: 'red-3', label: 'Rojo medio',   color: 'hsl(var(--group-red-3))' },
  { id: 'red-4', label: 'Rojo oscuro',  color: 'hsl(var(--group-red-4))' },
  { id: 'red-5', label: 'Rojo profundo',color: 'hsl(var(--group-red-5))' },
  // Naranja
  { id: 'orange-1', label: 'Naranja claro',   color: 'hsl(var(--group-orange-1))' },
  { id: 'orange-2', label: 'Naranja',          color: 'hsl(var(--group-orange-2))' },
  { id: 'orange-3', label: 'Naranja medio',    color: 'hsl(var(--group-orange-3))' },
  { id: 'orange-4', label: 'Naranja oscuro',   color: 'hsl(var(--group-orange-4))' },
  { id: 'orange-5', label: 'Naranja profundo', color: 'hsl(var(--group-orange-5))' },
  // Amarillo
  { id: 'yellow-1', label: 'Amarillo claro',   color: 'hsl(var(--group-yellow-1))' },
  { id: 'yellow-2', label: 'Amarillo',          color: 'hsl(var(--group-yellow-2))' },
  { id: 'yellow-3', label: 'Amarillo medio',    color: 'hsl(var(--group-yellow-3))' },
  { id: 'yellow-4', label: 'Amarillo oscuro',   color: 'hsl(var(--group-yellow-4))' },
  { id: 'yellow-5', label: 'Amarillo profundo', color: 'hsl(var(--group-yellow-5))' },
  // Verde
  { id: 'green-1', label: 'Verde claro',   color: 'hsl(var(--group-green-1))' },
  { id: 'green-2', label: 'Verde',          color: 'hsl(var(--group-green-2))' },
  { id: 'green-3', label: 'Verde medio',    color: 'hsl(var(--group-green-3))' },
  { id: 'green-4', label: 'Verde oscuro',   color: 'hsl(var(--group-green-4))' },
  { id: 'green-5', label: 'Verde profundo', color: 'hsl(var(--group-green-5))' },
  // Azul
  { id: 'blue-1', label: 'Azul claro',   color: 'hsl(var(--group-blue-1))' },
  { id: 'blue-2', label: 'Azul',          color: 'hsl(var(--group-blue-2))' },
  { id: 'blue-3', label: 'Azul medio',    color: 'hsl(var(--group-blue-3))' },
  { id: 'blue-4', label: 'Azul oscuro',   color: 'hsl(var(--group-blue-4))' },
  { id: 'blue-5', label: 'Azul profundo', color: 'hsl(var(--group-blue-5))' },
  // Morado
  { id: 'purple-1', label: 'Morado claro',   color: 'hsl(var(--group-purple-1))' },
  { id: 'purple-2', label: 'Morado',          color: 'hsl(var(--group-purple-2))' },
  { id: 'purple-3', label: 'Morado medio',    color: 'hsl(var(--group-purple-3))' },
  { id: 'purple-4', label: 'Morado oscuro',   color: 'hsl(var(--group-purple-4))' },
  { id: 'purple-5', label: 'Morado profundo', color: 'hsl(var(--group-purple-5))' },
];

export const getGroupColor = (colorId?: string | null): string =>
  GROUP_COLORS.find(c => c.id === colorId)?.color ?? 'hsl(var(--muted-foreground))';

export const statusColors: Record<string, string> = {
  'Pendiente':   'hsl(var(--muted-foreground))',
  'En progreso': 'hsl(var(--primary))',
  'Completada':  'hsl(var(--chart-2))',
  'Bloqueada':   'hsl(var(--destructive))',
};

/** Map a dynamic column type to the FilterColumn type used by useTableFilters */
export function dynColFilterType(colType: string | null | undefined): FilterColumn['type'] {
  switch (colType) {
    case 'Número': case 'Rating': return 'number';
    case 'Fecha':  case 'Datetime': return 'date';
    case 'Status': case 'Select': case 'Checkbox': return 'select';
    default: return 'text';
  }
}

/** Parse options labels from a Status/Select column's optionsJson */
export function parseDynColOptions(col: DynColumn): string[] | undefined {
  if (col.columnType !== 'Status' && col.columnType !== 'Select') {
    if (col.columnType === 'Checkbox') return ['Sí', 'No'];
    return undefined;
  }
  try {
    const opts = JSON.parse(col.optionsJson ?? '[]');
    if (!Array.isArray(opts)) return undefined;
    return (opts as unknown[])
      .map(o => typeof o === 'string' ? o : (o as { label?: string }).label ?? '')
      .filter(Boolean);
  } catch { return undefined; }
}

/** Convert a dynamic column to a FilterColumn descriptor */
export function dynColToFilterCol(col: DynColumn): FilterColumn {
  return {
    key: col.id,
    label: col.columnName ?? 'Sin nombre',
    type: dynColFilterType(col.columnType),
    options: parseDynColOptions(col),
  };
}

/** Extract a display string from a cell value for use in filters */
export function cellDisplayValue(cell: DynCellValue | undefined, colType: string | null | undefined): string {
  if (!cell) return '';
  if (colType === 'Checkbox') return cell.booleanValue != null ? (cell.booleanValue ? 'Sí' : 'No') : '';
  if (colType === 'Número' || colType === 'Rating') return cell.numberValue != null ? String(cell.numberValue) : '';
  if (colType === 'Fecha' || colType === 'Datetime') return cell.dateValue ? cell.dateValue.split('T')[0] : '';
  return formatAddressText(cell.textValue);
}

export function useResizableCol(storageKey: string, defaultWidth = 250, minWidth = 120) {
  const [width, setWidth] = useState(() => {
    const s = localStorage.getItem(storageKey);
    return s ? Math.max(minWidth, parseInt(s, 10)) : defaultWidth;
  });
  // Consumer attaches this ref to their <col> element so we can mutate its
  // style.width directly during drag — zero React re-renders per frame.
  const colRef = useRef<HTMLElement | null>(null);

  const startResize = (startX: number) => {
    const startW = width;
    let currentW = startW;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
      currentW = Math.max(minWidth, startW + e.clientX - startX);
      if (colRef.current) colRef.current.style.width = `${currentW}px`;
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Single setState + localStorage write only on release
      setWidth(currentW);
      localStorage.setItem(storageKey, String(currentW));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return { width, startResize, colRef };
}
