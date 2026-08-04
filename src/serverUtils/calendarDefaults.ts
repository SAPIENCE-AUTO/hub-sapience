import { BoardColumns } from 'zite-integrations-backend-sdk';

export const CAL_DEFAULT_COLUMNS = [
  { columnName: 'Responsable',            columnType: 'Persona',  columnOrder: 500   },
  { columnName: 'Fecha y hora',           columnType: 'Datetime', columnOrder: 1000  },
  { columnName: 'Duración (hrs)',         columnType: 'Número',   columnOrder: 2000  },
  { columnName: 'Dinámica',               columnType: 'Texto',    columnOrder: 3000  },
  { columnName: 'Perfil',                 columnType: 'Texto',    columnOrder: 4000  },
  { columnName: 'Descripción',            columnType: 'Texto',    columnOrder: 5000  },
  { columnName: 'Detalles adicionales',   columnType: 'Texto',    columnOrder: 6000  },
  { columnName: 'Detalles adicionales 2', columnType: 'Texto',    columnOrder: 7000  },
  { columnName: 'Status',                 columnType: 'Select',   columnOrder: 8000, optionsJson: JSON.stringify(['Por realizar', 'Realizada', 'Cancelada', 'Reprogramada', 'Caída', 'Reposición']) },
  { columnName: 'Ubicación Interna',      columnType: 'Select',   columnOrder: 9000, optionsJson: JSON.stringify(['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro']) },
  { columnName: 'Link',                   columnType: 'Texto',    columnOrder: 11000 },
  { columnName: 'Dirección',              columnType: 'Texto',    columnOrder: 12000 },
] as const;

/**
 * Ensure a calendar board has its 12 default columns.
 * Skips creation if columns already exist for the given boardId.
 * Returns the created column records, or an empty array if they already existed.
 */
export async function ensureCalendarDefaultColumns(boardId: string) {
  const { records: existing } = await BoardColumns.findAll({
    filters: { boardId },
    limit: 1,
  });

  if (existing.length > 0) return [];

  const result = await BoardColumns.bulkCreate({
    records: CAL_DEFAULT_COLUMNS.map(col => ({
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
    columnName: r.fields.columnName ?? undefined,
    columnType: r.fields.columnType ?? undefined,
    optionsJson: r.fields.optionsJson ?? undefined,
    columnOrder: r.fields.columnOrder ?? undefined,
  }));
}
