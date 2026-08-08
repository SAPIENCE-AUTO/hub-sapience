import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues } from '../../server/compat';

const eventInfoSchema = z.object({
  eventName: z.string().optional(),
  eventDate: z.string().optional(),
  durationHours: z.number().optional(),
  location: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Batch-fetch calendar event info for a list of eventIds. Returns a map { [eventId]: eventInfo }. Falls back to dynamic CellValues when native fields are null.',
  inputSchema: z.object({
    eventIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    events: z.record(z.string(), eventInfoSchema),
  }),
  execute: async ({ input }) => {
    const { eventIds } = input;
    if (eventIds.length === 0) return { events: {} };

    const { records } = await CalendarEvents.findAll({
      filters: { id: { in: eventIds } },
      limit: 2000,
    });

    const events: Record<string, z.infer<typeof eventInfoSchema>> = {};
    const needsFallback: string[] = [];

    for (const ev of records) {
      events[ev.id] = {
        eventName: ev.eventName,
        eventDate: ev.eventDate ?? undefined,
        durationHours: ev.durationHours ?? undefined,
        location: ev.location ?? undefined,
      };
      // Flag events that need dynamic column fallback
      if (!ev.eventDate) needsFallback.push(ev.id);
    }

    // ── Fallback: read dynamic CellValues for events missing native fields ──
    if (needsFallback.length > 0) {
      // Get all cell values for these events
      const { records: cells } = await CellValues.findAll({
        filters: { rowId: { in: needsFallback } },
        limit: 2000,
      });

      if (cells.length > 0) {
        // Get unique column IDs referenced by these cells
        const colIds = [...new Set(cells.map(c => c.columnId).filter((id): id is string => !!id))];
        const { records: cols } = await BoardColumns.findAll({
          filters: { id: { in: colIds } },
          limit: 500,
        });

        const colById = new Map(cols.map(c => [c.id, c]));

        for (const cell of cells) {
          const eventId = cell.rowId;
          if (!eventId || !events[eventId]) continue;
          const col = colById.get(cell.columnId ?? '');
          if (!col?.columnName) continue;

          if (col.columnName === 'Fecha y hora' && cell.dateValue && !events[eventId].eventDate) {
            events[eventId].eventDate = cell.dateValue;
          } else if (col.columnName === 'Duración (hrs)' && cell.numberValue != null && events[eventId].durationHours == null) {
            events[eventId].durationHours = cell.numberValue;
          } else if ((col.columnName === 'Ubicación Interna' || col.columnName === 'Ubicación (interna)') && cell.textValue && !events[eventId].location) {
            events[eventId].location = cell.textValue;
          }
        }
      }
    }

    return { events };
  },
});
