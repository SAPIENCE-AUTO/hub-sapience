import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues } from 'zite-integrations-backend-sdk';

const DATE_NAMES = ['Fecha y hora'];
const DUR_NAMES  = ['Duración (hrs)'];
const LOC_NAMES  = ['Ubicación Interna', 'Ubicación (interna)', 'Espacio', 'Ubicación'];

export default createEndpoint({
  authenticated: true,
  description: 'Sync stale CellValues to match native CalendarEvents fields. Supports dry-run mode.',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    boardId: z.string().optional(),
    dryRun: z.boolean().default(true),
  }),
  outputSchema: z.object({
    scannedEvents: z.number(),
    mismatchedDateCount: z.number(),
    mismatchedDurationCount: z.number(),
    mismatchedLocationCount: z.number(),
    fixedCount: z.number(),
    examples: z.array(z.object({
      eventId: z.string(),
      eventName: z.string(),
      field: z.string(),
      nativeValue: z.any(),
      cellValue: z.any(),
    })),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardId: filterBoardId, dryRun } = input;

    // Load events with optional filters
    const filters: Record<string, any> = {};
    if (projectCode) filters.projectCode = projectCode;
    if (filterBoardId) filters.boardId = filterBoardId;

    let allEvents: any[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await CalendarEvents.findAll({ filters, offset, limit: 2000 });
      allEvents = allEvents.concat(res.records);
      hasMore = res.hasMore;
      offset += res.records.length;
    }

    // Group by boardId
    const byBoard: Record<string, any[]> = {};
    for (const ev of allEvents) {
      if (!ev.boardId) continue;
      (byBoard[ev.boardId] ??= []).push(ev);
    }

    let mismatchedDateCount = 0;
    let mismatchedDurationCount = 0;
    let mismatchedLocationCount = 0;
    let fixedCount = 0;
    const examples: { eventId: string; eventName: string; field: string; nativeValue: any; cellValue: any }[] = [];

    for (const [bid, events] of Object.entries(byBoard)) {
      const { records: cols } = await BoardColumns.findAll({ filters: { boardId: bid }, limit: 100 });
      const activeCols = cols.filter(c => !c.deletedAt);
      if (activeCols.length === 0) continue;

      const dateCol = activeCols.find(c => DATE_NAMES.includes(c.columnName ?? ''));
      const durCol  = activeCols.find(c => DUR_NAMES.includes(c.columnName ?? ''));
      const locCol  = activeCols.find(c => LOC_NAMES.includes(c.columnName ?? ''));

      // Bulk load cells
      let allCells: any[] = [];
      let cOff = 0;
      let cMore = true;
      while (cMore) {
        const r = await CellValues.findAll({ filters: { boardId: bid }, offset: cOff, limit: 2000 });
        allCells = allCells.concat(r.records);
        cMore = r.hasMore;
        cOff += r.records.length;
      }
      const cellMap: Record<string, any> = {};
      for (const c of allCells) cellMap[`${c.rowId}|${c.columnId}`] = c;

      for (const ev of events) {
        // eventDate
        if (dateCol && ev.eventDate) {
          const cell = cellMap[`${ev.id}|${dateCol.id}`];
          if (cell && cell.dateValue !== ev.eventDate) {
            mismatchedDateCount++;
            examples.push({ eventId: ev.id, eventName: ev.eventName ?? '', field: 'eventDate', nativeValue: ev.eventDate, cellValue: cell.dateValue });
            if (!dryRun) {
              await CellValues.update({ id: cell.id, record: { dateValue: ev.eventDate } });
              fixedCount++;
            }
          }
        }
        // durationHours
        if (durCol && ev.durationHours != null) {
          const cell = cellMap[`${ev.id}|${durCol.id}`];
          if (cell && cell.numberValue !== ev.durationHours) {
            mismatchedDurationCount++;
            examples.push({ eventId: ev.id, eventName: ev.eventName ?? '', field: 'durationHours', nativeValue: ev.durationHours, cellValue: cell.numberValue });
            if (!dryRun) {
              await CellValues.update({ id: cell.id, record: { numberValue: ev.durationHours } });
              fixedCount++;
            }
          }
        }
        // location
        if (locCol && ev.location) {
          const cell = cellMap[`${ev.id}|${locCol.id}`];
          if (cell && cell.textValue !== ev.location) {
            mismatchedLocationCount++;
            examples.push({ eventId: ev.id, eventName: ev.eventName ?? '', field: 'location', nativeValue: ev.location, cellValue: cell.textValue });
            if (!dryRun) {
              await CellValues.update({ id: cell.id, record: { textValue: ev.location } });
              fixedCount++;
            }
          }
        }
      }
    }

    return {
      scannedEvents: allEvents.length,
      mismatchedDateCount,
      mismatchedDurationCount,
      mismatchedLocationCount,
      fixedCount,
      examples: examples.slice(0, 50),
    };
  },
});
