import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns } from '../../server/compat';

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

// Saved format in excelColumnsJson: { order: string[], selected: string[] }
// Backwards-compat: if it's a plain string[] (old format), treat all as selected with original order
type SavedConfig = { order: string[]; selected: string[] };

export default createEndpoint({
  authenticated: true,
  description: 'Gets the available columns (in saved order) and previously saved selection for calendar Excel export',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    calendarName: z.string().optional(),
    boardId: z.string().optional(),
  }),
  outputSchema: z.object({
    columns: z.array(z.object({
      id:    z.string(),
      title: z.string(),
      type:  z.string(),
    })),
    selectedIds: z.array(z.string()),
    nextVersion: z.number(),
  }),
  execute: async ({ input }) => {
    let resolvedBoardId: string;
    let boardResult: any = null;

    if (input.boardId) {
      // ── UUID-first: use boardId directly, skip ALL legacy resolution ──
      resolvedBoardId = input.boardId;
      boardResult = await Boards.findOne({ id: input.boardId });
    } else {
      // ── Legacy path: require projectCode + calendarName ──
      if (!input.projectCode || !input.calendarName) {
        throw new Error('Either boardId or both projectCode and calendarName are required.');
      }

      // Ambiguity detection
      const boardsResult = await Boards.findAll({
        filters: { boardName: input.calendarName, projectCode: input.projectCode, boardType: 'calendar' } as any,
        limit: 10,
      });
      const activeBoards = boardsResult.records.filter(b => !b.deletedAt);
      if (activeBoards.length > 1) {
        throw new Error(`Ambiguity: ${activeBoards.length} calendars named "${input.calendarName}" for project ${input.projectCode}. Pass boardId to disambiguate.`);
      }
      if (activeBoards.length === 1) {
        resolvedBoardId = activeBoards[0].id;
        boardResult = activeBoards[0];
      } else {
        // Last resort legacy composite
        resolvedBoardId = `cal-${input.projectCode}-${input.calendarName}`;
        boardResult = null;
      }
    }

    // ── Fetch columns using resolved UUID ──
    const colRes = await BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 200 });
    let activeCols = colRes.records.filter(c => !c.deletedAt);

    // ── Auto-create default columns if board has none ─────────────────────────
    if (activeCols.length === 0) {
      const defaultCols = [
        { columnName: 'Fecha y hora',          columnType: 'Datetime', optionsJson: undefined },
        { columnName: 'Duración (hrs)',         columnType: 'Número',   optionsJson: undefined },
        { columnName: 'Dinámica',               columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Perfil',                 columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Descripción',            columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Detalles adicionales',   columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Detalles adicionales 2', columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Status',                 columnType: 'Select',   optionsJson: JSON.stringify(['Por realizar', 'Realizada', 'Cancelada', 'Reprogramada', 'Caída', 'Reposición']) },
        { columnName: 'Ubicación Interna',      columnType: 'Select',   optionsJson: JSON.stringify(['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro']) },
        { columnName: 'Dirección',              columnType: 'Texto',    optionsJson: undefined },
        { columnName: 'Link',                   columnType: 'Texto',    optionsJson: undefined },
      ];
      await BoardColumns.bulkCreate({
        records: defaultCols.map((col, i) => ({
          boardId: resolvedBoardId,
          columnName: col.columnName,
          columnType: col.columnType,
          optionsJson: col.optionsJson,
          columnOrder: i,
        })),
      });
      const freshRes = await BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 200 });
      activeCols = freshRes.records.filter(c => !c.deletedAt);
    }

    // Exclude "Ubicación Interna" — internal field, never exported to Excel
    activeCols = activeCols.filter(c => c.columnName !== 'Ubicación Interna' && c.columnName !== 'Ubicación (interna)');

    // Dedup by name (last wins)
    const deduped = new Map<string, typeof activeCols[0]>();
    for (const col of activeCols) {
      deduped.set((col.columnName ?? col.id).toLowerCase().trim(), col);
    }

    // Expand Datetime columns into two separate (Fecha) and (Hora) columns
    const allColumns: { id: string; title: string; type: string }[] = [];
    for (const col of Array.from(deduped.values())) {
      const type  = mapColType(col.columnType);
      const title = col.columnName ?? col.id;
      if (type === 'datetime') {
        allColumns.push({ id: `${col.id}__fecha`, title: 'Fecha', type: 'date' });
        allColumns.push({ id: `${col.id}__hora`,  title: 'Hora',  type: 'time' });
      } else {
        allColumns.push({ id: col.id, title, type });
      }
    }
    const allIds       = new Set(allColumns.map(c => c.id));
    const colById      = new Map(allColumns.map(c => [c.id, c]));

    // Parse saved config (supports both old string[] and new {order,selected} formats)
    let savedOrder:    string[] | null = null;
    let savedSelected: string[] | null = null;

    if (boardResult?.excelColumnsJson) {
      try {
        const parsed = JSON.parse(boardResult.excelColumnsJson);
        if (Array.isArray(parsed)) {
          savedSelected = (parsed as string[]).filter(id => allIds.has(id));
        } else if (parsed && Array.isArray(parsed.order) && Array.isArray(parsed.selected)) {
          const cfg = parsed as SavedConfig;
          savedOrder    = cfg.order.filter(id => allIds.has(id));
          savedSelected = cfg.selected.filter(id => allIds.has(id));
        }
      } catch { /* bad JSON — use defaults */ }
    }

    // Apply saved order: sorted columns first, then any new columns not in saved order
    let orderedColumns = allColumns;
    if (savedOrder && savedOrder.length > 0) {
      const inOrder    = savedOrder.map(id => colById.get(id)!).filter(Boolean);
      const remainder  = allColumns.filter(c => !savedOrder!.includes(c.id));
      orderedColumns   = [...inOrder, ...remainder];
    }

    // Selected IDs (default = all)
    const selectedIds = savedSelected && savedSelected.length > 0
      ? savedSelected
      : orderedColumns.map(c => c.id);

    const nextVersion = (boardResult?.calendarVersion ?? 0) + 1;

    return { columns: orderedColumns, selectedIds, nextVersion };
  },
});
