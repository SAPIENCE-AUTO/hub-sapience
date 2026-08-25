import { CalendarEvents, Projects, BoardColumns, CellValues, Boards } from '../../server/compat';

const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Formato pedido para el Excel de calendario: "31 - ago - 2026". */
export function formatFechaExcel(date: Date, timeZone = 'America/Mexico_City'): string {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const [y, m, d] = iso.split('-');
  return `${d} - ${MESES_ABREV[Number(m) - 1]} - ${y}`;
}

function toKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function mapColType(type: string | null | undefined): string {
  switch (type) {
    case 'Status':        return 'status';
    case 'Fecha':         return 'date';
    case 'Datetime':      return 'datetime';
    case 'Persona':       return 'people';
    case 'Color':         return 'color_picker';
    case 'Texto':         return 'text';
    case 'Número':        return 'numbers';
    case 'Número entero': return 'numbers';
    case 'Select':        return 'dropdown';
    default:              return (type ?? 'text').toLowerCase();
  }
}

function colDefaults(type: string): { width: number; align: string } {
  switch (type) {
    case 'date': case 'datetime': case 'time': return { width: 12, align: 'center' };
    case 'numbers': case 'number':              return { width: 10, align: 'center' };
    case 'status': case 'dropdown':             return { width: 14, align: 'center' };
    case 'people':                              return { width: 14, align: 'left'   };
    default:                                    return { width: 20, align: 'left'   };
  }
}

const FIXED_DEFS = [
  { id: 'dinamica',    key: 'dinamica',    title: 'Dinámica',    type: 'text',   width: 20, align: 'left'   },
  { id: 'fecha',       key: 'fecha',       title: 'Fecha',       type: 'date',   width: 12, align: 'center' },
  { id: 'hora_mx',     key: 'hora_mx',     title: 'Hora (MX)',   type: 'time',   width: 11, align: 'center' },
  { id: 'duracion',    key: 'duracion',    title: 'Duración',    type: 'number', width: 10, align: 'center' },
  { id: 'moderador',   key: 'moderador',   title: 'Moderador',   type: 'text',   width: 14, align: 'left'   },
  { id: 'descripcion', key: 'descripcion', title: 'Descripción', type: 'text',   width: 30, align: 'left'   },
] as const;

export type ColDef = { id: string; key: string; title: string; type: string; width: number; align: string; optionsJson?: string | null };
export interface CalendarExcelGroup {
  groupId: string;
  groupName: string;
  colorId: string | null;
  rows: Record<string, string | number>[];
}
export interface CalendarExcelData {
  resolvedBoardId: string;
  boardResult: any;
  projectResult: any;
  calendarTitle: string;
  allDefs: ColDef[];
  groups: CalendarExcelGroup[];
  eventCount: number;
}

/** Resuelve el tablero, trae eventos/columnas/celdas/grupos y arma las filas planas —
 * lógica compartida entre sendCalendarToWebhook.ts (genera el .xlsx real) y
 * getCalendarExcelPreview.ts (alimenta el preview en vivo del diálogo). El orden y la
 * selección de columnas NO se aplican aquí — son una decisión de cada caller/de la UI,
 * esta función siempre devuelve el universo completo de columnas y filas. */
export async function fetchCalendarExcelData(input: {
  projectCode: string;
  calendarName?: string;
  boardId?: string;
}): Promise<CalendarExcelData> {
  // ── Resolve board UUID ─────────────────────────────────────────────────
  let resolvedBoardId: string;
  let boardResult: any = null;

  if (input.boardId) {
    resolvedBoardId = input.boardId;
    boardResult = await Boards.findOne({ id: input.boardId });
  } else {
    if (!input.calendarName) throw new Error('Either boardId or calendarName is required.');
    const boardsResult = await Boards.findAll({
      filters: { boardName: input.calendarName, projectCode: input.projectCode, boardType: 'calendar' } as any,
      limit: 10,
    });
    const activeBoards = boardsResult.records.filter(b => !b.deletedAt);
    if (activeBoards.length > 1) {
      throw new Error(`Ambiguity: ${activeBoards.length} calendars named "${input.calendarName}" exist for project ${input.projectCode}. Pass boardId to disambiguate.`);
    }
    if (activeBoards.length === 1) {
      resolvedBoardId = activeBoards[0].id;
      boardResult = activeBoards[0];
    } else {
      resolvedBoardId = `cal-${input.projectCode}-${input.calendarName}`;
      boardResult = null;
    }
  }

  const groupBoardId = `${resolvedBoardId}::groups`;

  const eventsFilter: Record<string, string> = input.boardId
    ? { boardId: input.boardId }
    : { projectCode: input.projectCode, calendarName: input.calendarName! };

  const [eventsResult, projectResult, colRes, cellRes, groupColRes, groupCellRes] = await Promise.all([
    CalendarEvents.findAll({ filters: eventsFilter as any, limit: 500 }),
    Projects.findOne({ filters: { projectCode: input.projectCode } }),
    BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 200 }),
    CellValues.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 2000 }),
    BoardColumns.findAll({ filters: { boardId: groupBoardId } as any, limit: 100 }),
    CellValues.findAll({ filters: { boardId: groupBoardId } as any, limit: 2000 }),
  ]);

  const events = eventsResult.records;

  const activeCols  = colRes.records.filter(c => !c.deletedAt);
  const activeCells = cellRes.records.filter(c => !c.deletedAt);

  const cellsByEventCol = new Map<string, Map<string, typeof activeCells[0]>>();
  for (const cell of activeCells) {
    if (!cell.rowId || !cell.columnId) continue;
    if (!cellsByEventCol.has(cell.rowId)) cellsByEventCol.set(cell.rowId, new Map());
    cellsByEventCol.get(cell.rowId)!.set(cell.columnId, cell);
  }

  const deduped = new Map<string, typeof activeCols[0]>();
  for (const col of activeCols) {
    deduped.set((col.columnName ?? col.id).toLowerCase().trim(), col);
  }

  const fixedColDefs: ColDef[] = FIXED_DEFS.map(fd => ({ ...fd }));
  const dynColDefs: ColDef[] = [];
  for (const [, col] of deduped) {
    const key  = toKey(col.columnName ?? col.id);
    const type = mapColType(col.columnType);
    const title = col.columnName ?? col.id;
    if (title === 'Ubicación Interna' || title === 'Ubicación (interna)') continue;
    if (type === 'datetime') {
      dynColDefs.push({ id: `${col.id}__fecha`, key: `${key}_fecha`, title: 'Fecha', type: 'date', width: 12, align: 'center' });
      dynColDefs.push({ id: `${col.id}__hora`,  key: `${key}_hora`,  title: 'Hora',  type: 'time', width: 11, align: 'center' });
    } else {
      const def = colDefaults(type);
      dynColDefs.push({ id: col.id, key, title, type, ...def, optionsJson: col.optionsJson ?? null });
    }
  }

  const allDefs: ColDef[] = [...fixedColDefs, ...dynColDefs];

  // ── Group membership ───────────────────────────────────────────────────
  const activeGroupCols  = groupColRes.records.filter(c => !c.deletedAt);
  const activeGroupCells = groupCellRes.records.filter(c => !c.deletedAt);
  activeGroupCols.sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

  const eventGroupMap = new Map<string, string>();
  for (const cell of activeGroupCells) {
    if (cell.textValue === '1' && cell.rowId && cell.columnId) {
      if (!eventGroupMap.has(cell.rowId)) eventGroupMap.set(cell.rowId, cell.columnId);
    }
  }

  // ── Build flat row ─────────────────────────────────────────────────────
  function buildRow(ev: typeof events[0]): Record<string, string | number> {
    const eventDate = ev.eventDate ? new Date(ev.eventDate) : null;
    const fecha     = eventDate ? formatFechaExcel(eventDate) : '';
    const hora_mx   = eventDate
      ? eventDate.toLocaleTimeString('es-MX', {
          hour: '2-digit', minute: '2-digit', hour12: false,
          timeZone: 'America/Mexico_City',
        })
      : '';

    const row: Record<string, string | number> = {
      rowId:       ev.id,
      dinamica:    ev.eventName ?? '',
      fecha,
      hora_mx,
      duracion:    ev.durationHours ?? '',
      moderador:   ev.attendees ?? '',
      descripcion: ev.notes ?? '',
    };

    const eventCells = cellsByEventCol.get(ev.id);
    for (const dyn of dynColDefs) {
      const isFecha   = dyn.id.endsWith('__fecha');
      const isHora    = dyn.id.endsWith('__hora');
      const realColId = (isFecha || isHora) ? dyn.id.replace(/__fecha$|__hora$/, '') : dyn.id;
      const cell      = eventCells?.get(realColId);
      let val: string | number = '';
      if (cell) {
        if (isFecha || isHora) {
          const rawDate = cell.dateValue;
          if (rawDate) {
            const d = new Date(rawDate);
            val = isFecha
              ? formatFechaExcel(d)
              : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
          }
        } else if (cell.textValue) {
          val = cell.textValue;
        } else if (cell.dateValue) {
          val = formatFechaExcel(new Date(cell.dateValue));
        } else if (cell.numberValue != null) {
          val = cell.numberValue;
        }
      }
      row[dyn.key] = val;
    }

    return row;
  }

  // ── Bucket events into groups ──────────────────────────────────────────
  const topLevelEvents = events.filter(e => !e.parentEventId);
  const groupBuckets   = new Map<string, typeof events>();
  for (const g of activeGroupCols) groupBuckets.set(g.id, []);
  const ungrouped: typeof events = [];

  for (const e of topLevelEvents) {
    const gid = eventGroupMap.get(e.id);
    if (gid && groupBuckets.has(gid)) groupBuckets.get(gid)!.push(e);
    else ungrouped.push(e);
  }

  const groups: CalendarExcelGroup[] = [];
  for (const g of activeGroupCols) {
    groups.push({
      groupId:   g.id,
      groupName: g.columnName ?? 'Sin nombre',
      colorId:   g.columnType ?? null,
      rows:      (groupBuckets.get(g.id) ?? []).map(buildRow),
    });
  }
  if (ungrouped.length > 0 || groups.length === 0) {
    groups.push({ groupId: 'ungrouped', groupName: 'Sin grupo', colorId: null, rows: ungrouped.map(buildRow) });
  }

  const calendarLabel = boardResult?.boardName ?? input.calendarName ?? 'Calendar';
  const tematica = (projectResult as any)?.tematica ?? '';
  const calendarTitle = tematica ? `${tematica} - ${calendarLabel}` : calendarLabel;

  return { resolvedBoardId, boardResult, projectResult, calendarTitle, allDefs, groups, eventCount: events.length };
}
