import { z } from 'zod';
import { createEndpoint, CalendarEvents, Boards } from 'zite-integrations-backend-sdk';

const dedup = <T extends { id: string }>(a: T[], b: T[]): T[] => {
  const seen = new Map<string, T>();
  for (const r of a) seen.set(r.id, r);
  for (const r of b) if (!seen.has(r.id)) seen.set(r.id, r);
  return Array.from(seen.values());
};

const eventSchema = z.object({
  id: z.string(),
  eventName: z.string().optional(),
  projectCode: z.string().optional(),
  calendarName: z.string().optional(),
  boardId: z.string().optional(),
  eventDate: z.string().optional(),
  durationHours: z.number().optional(),
  location: z.string().optional(),
  attendees: z.string().optional(),
  notes: z.string().optional(),
  parentEventId: z.string().optional(),
  inviteStatus: z.string().optional(),
  outlookEventId: z.string().optional(),
  outlookEventLink: z.string().optional(),
  inviteBodyHtml: z.string().optional(),
  inviteEmails: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get all calendar events, optionally filtered by date range. Excludes events from deleted calendar boards.',
  inputSchema: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    boardId: z.string().optional(),
    projectCode: z.string().optional(),
    calendarName: z.string().optional(),
  }),
  outputSchema: z.object({ events: z.array(eventSchema) }),
  execute: async ({ input }) => {
    // Build date filters
    const dateFilters: Record<string, any> = {};
    if (input.startDate && input.endDate) {
      dateFilters.eventDate = { gte: new Date(input.startDate), lte: new Date(input.endDate) };
    } else if (input.startDate) {
      dateFilters.eventDate = { gte: new Date(input.startDate) };
    } else if (input.endDate) {
      dateFilters.eventDate = { lte: new Date(input.endDate) };
    }

    let records: any[];

    if (input.boardId) {
      // ── UUID-first: boardId exclusively ──
      const q1 = await CalendarEvents.findAll({
        filters: { boardId: input.boardId, ...dateFilters },
        limit: 2000,
      });

      // Also pick up legacy events that have no boardId but match by name (transition period)
      let fallback: any[] = [];
      if (input.projectCode && input.calendarName) {
        const q2 = await CalendarEvents.findAll({
          filters: { projectCode: input.projectCode, calendarName: input.calendarName, ...dateFilters },
          limit: 2000,
        });
        fallback = q2.records.filter(e => !e.boardId);
      }

      records = dedup(q1.records, fallback);
    } else {
      // ── Legacy path (unchanged) ──
      const result = await CalendarEvents.findAll({ filters: dateFilters, limit: 2000 });
      records = result.records;
    }

    // ── Fetch active calendar boards — build UUID set + legacy key set ──
    const { records: activeBoards } = await Boards.findAll({
      filters: { deletedAt: null as any, boardType: 'calendar' },
      fields: ['boardName', 'projectCode'],
      limit: 500,
    });

    const activeBoardIds = new Set(activeBoards.map(b => b.id));
    const activeBoardKeys = new Set(
      activeBoards.map(b => `${b.projectCode ?? ''}||${b.boardName ?? ''}`)
    );

    // ── Filter: UUID-first validation, legacy fallback for old events ──
    const events = records.filter(ev => {
      if (ev.boardId) {
        // Event has UUID → validate against active board IDs
        return activeBoardIds.has(ev.boardId);
      }
      if (ev.calendarName) {
        // No UUID, legacy event → validate against name-based keys
        const key = `${ev.projectCode ?? ''}||${ev.calendarName}`;
        return activeBoardKeys.has(key);
      }
      // No boardId, no calendarName → orphan-safe, include it
      return true;
    });

    return {
      events: events.map(ev => ({
        id: ev.id,
        eventName: ev.eventName,
        projectCode: ev.projectCode,
        calendarName: ev.calendarName,
        boardId: ev.boardId,
        eventDate: ev.eventDate,
        durationHours: ev.durationHours,
        location: ev.location,
        attendees: ev.attendees,
        notes: ev.notes,
        parentEventId: ev.parentEventId,
        inviteStatus: ev.inviteStatus,
        outlookEventId: ev.outlookEventId,
        outlookEventLink: ev.outlookEventLink,
        inviteBodyHtml: ev.inviteBodyHtml,
        inviteEmails: ev.inviteEmails,
      })),
    };
  },
});
