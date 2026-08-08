import { BoardColumns } from '../../server/compat';

const STATUS_OPTIONS = JSON.stringify([
  { label: 'Pendiente',   color: 'gray'  },
  { label: 'En progreso', color: 'blue'  },
  { label: 'Completada',  color: 'green' },
  { label: 'Bloqueada',   color: 'red'   },
]);

export const PM_DEFAULT_COLUMNS = [
  { columnName: 'Estado',      columnType: 'Status',  columnOrder: 500,  optionsJson: STATUS_OPTIONS },
  { columnName: 'Responsable', columnType: 'Persona', columnOrder: 1000 },
  { columnName: 'Color',       columnType: 'Color',   columnOrder: 1500 },
] as const;

/**
 * Ensure a PM timeline board has its 3 default columns (Estado, Responsable, Color).
 * Skips creation if columns already exist for the given boardId.
 * Returns the created column records, or an empty array if they already existed.
 */
export async function ensureTimelineDefaultColumns(boardId: string) {
  const { records: existing } = await BoardColumns.findAll({
    filters: { boardId },
    limit: 1,
  });

  if (existing.length > 0) return [];

  const result = await BoardColumns.bulkCreate({
    records: PM_DEFAULT_COLUMNS.map(col => ({
      boardId,
      columnName: col.columnName,
      columnType: col.columnType,
      columnOrder: col.columnOrder,
      ...('optionsJson' in col ? { optionsJson: col.optionsJson } : {}),
    })),
  });

  return result.records.map(r => ({
    id: r.id,
    boardId,
    columnName: r.columnName ?? undefined,
    columnType: r.columnType ?? undefined,
    optionsJson: r.optionsJson ?? undefined,
    columnOrder: r.columnOrder ?? undefined,
  }));
}
