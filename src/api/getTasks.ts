import { z } from 'zod';
import { createEndpoint, Tasks, CalendarEvents, Boards, pool } from '../../server/compat';

const dedup = <T extends { id: string }>(a: T[], b: T[]): T[] => {
  const seen = new Map<string, T>();
  for (const r of a) seen.set(r.id, r);
  for (const r of b) if (!seen.has(r.id)) seen.set(r.id, r);
  return Array.from(seen.values());
};

const TASK_FIELDS = ['taskName', 'projectCode', 'boardName', 'status', 'assignedTo', 'startDate', 'endDate', 'parentTaskId', 'order', 'notes', 'boardId', 'deletedAt'] as const;
const EVENT_FIELDS = ['eventName', 'projectCode', 'calendarName', 'eventDate', 'durationHours', 'location', 'attendees', 'inviteSent', 'notes', 'parentEventId', 'inviteStatus', 'outlookEventId', 'outlookEventLink', 'inviteBodyHtml', 'inviteEmails', 'boardId', 'restringirReenvio'] as const;

const taskSchema = z.object({
  id: z.string(),
  taskName: z.string().optional(),
  projectCode: z.string().optional(),
  boardName: z.string().optional(),
  boardId: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  parentTaskId: z.string().optional(),
  order: z.number().optional(),
  notes: z.string().optional(),
});

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
  inviteSent: z.boolean().optional(),
  notes: z.string().optional(),
  parentEventId: z.string().optional(),
  inviteStatus: z.string().optional(),
  outlookEventId: z.string().optional(),
  outlookEventLink: z.string().optional(),
  inviteBodyHtml: z.string().optional(),
  inviteEmails: z.string().optional(),
  restringirReenvio: z.boolean().optional(),
  hasZoom: z.boolean().optional(),
  zoomNeedsUpdate: z.boolean().optional(),
});

/** Zoom status por evento, para la pastilla en la vista de lista (EventsTable.tsx)
 *  — sin esto solo se ve si abres el detalle del evento uno por uno. */
async function fetchZoomStatusByEventIds(eventIds: string[]): Promise<Map<string, { hasZoom: boolean; zoomNeedsUpdate: boolean }>> {
  if (eventIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `select calendar_event_id, zoom_meeting_id, zoom_needs_update from observation_sessions where calendar_event_id = any($1::uuid[])`,
    [eventIds],
  );
  return new Map(rows.map((r: any) => [r.calendar_event_id, { hasZoom: !!r.zoom_meeting_id, zoomNeedsUpdate: !!r.zoom_needs_update }]));
}

/** Fetch tasks with dual-read: boardId primary + legacy fallback for unmigrated records */
async function fetchTasksDualRead(input: { boardId: string; projectCode?: string; boardName?: string }) {
  const q1Filters: Record<string, string> = { boardId: input.boardId };
  if (input.projectCode) q1Filters.projectCode = input.projectCode;

  const q1 = await Tasks.findAll({ filters: q1Filters, limit: 500, fields: [...TASK_FIELDS] });

  // Legacy fallback: only if we have enough info, and only keep records WITHOUT boardId
  if (input.projectCode && input.boardName) {
    const q2 = await Tasks.findAll({
      filters: { projectCode: input.projectCode, boardName: input.boardName },
      limit: 500,
      fields: [...TASK_FIELDS],
    });
    const fallback = q2.records.filter(t => !t.boardId);
    return sortByOrder(excludeDeleted(dedup(q1.records, fallback)));
  }

  return sortByOrder(excludeDeleted(q1.records));
}

// `Tasks.findAll` no aplica ORDER BY por default — sin esto, Postgres devuelve
// las filas en orden físico (no el orden lógico del proyecto), que puede salir
// invertido respecto al campo `order` que reorderTasks.ts sí mantiene al día.
const sortByOrder = <T extends { order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// Tasks ahora sí tiene borrado suave (deletedAt) — sin este filtro las tareas
// en la papelera reaparecerían en el Gantt/listas.
const excludeDeleted = (rows: any[]): any[] => rows.filter(r => !r.deletedAt);

export default createEndpoint({
  authenticated: true,
  description: 'Get tasks, calendar events, and PM/calendar boards for a project',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    boardName: z.string().optional(),
    boardId: z.string().optional(),
    only: z.enum(['tasks', 'events']).optional(),
  }),
  outputSchema: z.object({
    tasks: z.array(taskSchema),
    calendarEvents: z.array(eventSchema),
    boards: z.array(z.string()),
    calendarBoards: z.array(z.string()),
    boardObjects: z.array(z.object({ id: z.string(), name: z.string(), boardType: z.string().optional(), boardOrder: z.number().optional() })),
    calendarBoardObjects: z.array(z.object({ id: z.string(), name: z.string(), boardType: z.string().optional(), boardOrder: z.number().optional() })),
  }),
  execute: async ({ input }) => {
    // ── Fast path: only tasks ──
    if (input.only === 'tasks') {
      if (input.boardId) {
        const tasks = await fetchTasksDualRead({ boardId: input.boardId, projectCode: input.projectCode, boardName: input.boardName });
        return { tasks, calendarEvents: [], boards: [], calendarBoards: [], boardObjects: [], calendarBoardObjects: [] };
      }
      // Legacy path
      const taskFilters: Record<string, string> = {};
      if (input.projectCode) taskFilters.projectCode = input.projectCode;
      if (input.boardName) taskFilters.boardName = input.boardName;
      const tasksResult = await Tasks.findAll({ filters: taskFilters, limit: 500, fields: [...TASK_FIELDS] });
      return { tasks: sortByOrder(excludeDeleted(tasksResult.records)), calendarEvents: [], boards: [], calendarBoards: [], boardObjects: [], calendarBoardObjects: [] };
    }

    // ── Fast path: only events ──
    // sorts por createdAt: a diferencia de Tasks (que sí tiene un `order`
    // manual mantenido por reorderTasks.ts), CalendarEvents nunca tuvo un
    // campo de orden propio — sin ORDER BY explícito, Postgres devuelve las
    // filas en su orden físico interno, que una UPDATE puede reacomodar
    // (mueve la fila a otra página del heap si ya no cabe en la original).
    // Eso hacía que editar un evento lo "saltara" de lugar en la lista.
    if (input.only === 'events') {
      const eventsResult = await CalendarEvents.findAll({
        filters: input.projectCode ? { projectCode: input.projectCode } : {},
        limit: 500,
        fields: [...EVENT_FIELDS],
        sorts: [{ field: 'createdAt', direction: 'asc' }],
      });
      const zoomByEventId = await fetchZoomStatusByEventIds(eventsResult.records.map(ev => ev.id));
      return {
        tasks: [],
        calendarEvents: eventsResult.records.map(ev => ({
          id: ev.id,
          eventName: ev.eventName,
          projectCode: ev.projectCode,
          calendarName: ev.calendarName,
          boardId: ev.boardId,
          eventDate: ev.eventDate,
          durationHours: ev.durationHours,
          location: ev.location,
          attendees: ev.attendees,
          inviteSent: ev.inviteSent,
          notes: ev.notes,
          parentEventId: ev.parentEventId,
          inviteStatus: ev.inviteStatus,
          outlookEventId: ev.outlookEventId,
          outlookEventLink: ev.outlookEventLink,
          inviteBodyHtml: ev.inviteBodyHtml,
          inviteEmails: ev.inviteEmails,
          restringirReenvio: ev.restringirReenvio ?? false,
          hasZoom: zoomByEventId.get(ev.id)?.hasZoom ?? false,
          zoomNeedsUpdate: zoomByEventId.get(ev.id)?.zoomNeedsUpdate ?? false,
        })),
        boards: [],
        calendarBoards: [],
        boardObjects: [],
        calendarBoardObjects: [],
      };
    }

    // ── Full path ──
    // Tasks: always prefer UUID-based fetch when boardId is available
    const tasksPromise = input.boardId
      ? fetchTasksDualRead({ boardId: input.boardId, projectCode: input.projectCode, boardName: input.boardName })
      : (async () => {
          const taskFilters: Record<string, string> = {};
          if (input.projectCode) taskFilters.projectCode = input.projectCode;
          if (input.boardName) taskFilters.boardName = input.boardName;
          const r = await Tasks.findAll({ filters: taskFilters, limit: 500, fields: [...TASK_FIELDS] });
          return sortByOrder(excludeDeleted(r.records));
        })();

    const [tasks, eventsResult, pmBoardsResult, calBoardsResult] = await Promise.all([
      tasksPromise,
      CalendarEvents.findAll({
        filters: input.projectCode ? { projectCode: input.projectCode } : {},
        limit: 500,
        fields: [...EVENT_FIELDS],
        sorts: [{ field: 'createdAt', direction: 'asc' }],
      }),
      Boards.findAll({
        filters: {
          ...(input.projectCode ? { projectCode: input.projectCode } : {}),
          boardType: 'pm',
        } as any,
        limit: 200,
        fields: ['boardName', 'boardType', 'boardOrder', 'deletedAt', 'projectCode'],
      }),
      Boards.findAll({
        filters: {
          ...(input.projectCode ? { projectCode: input.projectCode } : {}),
          boardType: 'calendar',
        } as any,
        limit: 200,
        fields: ['boardName', 'boardType', 'boardOrder', 'deletedAt', 'projectCode'],
      }),
    ]);

    const boards = pmBoardsResult.records
      .filter(b => !b.deletedAt)
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => b.boardName ?? '')
      .filter(Boolean);

    const calendarBoards = calBoardsResult.records
      .filter(b => !b.deletedAt)
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => b.boardName ?? '')
      .filter(Boolean);

    const pmBoardObjects = pmBoardsResult.records
      .filter(b => !b.deletedAt && b.boardName)
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => ({ id: b.id, name: b.boardName ?? '', boardType: b.boardType ?? 'pm', boardOrder: b.boardOrder ?? 0 }));

    const calBoardObjects = calBoardsResult.records
      .filter(b => !b.deletedAt && b.boardName)
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => ({ id: b.id, name: b.boardName ?? '', boardType: b.boardType ?? 'calendar', boardOrder: b.boardOrder ?? 0 }));

    const zoomByEventId = await fetchZoomStatusByEventIds(eventsResult.records.map(ev => ev.id));

    return {
      tasks,
      calendarEvents: eventsResult.records.map(ev => ({
        id: ev.id,
        eventName: ev.eventName,
        projectCode: ev.projectCode,
        calendarName: ev.calendarName,
        boardId: ev.boardId,
        eventDate: ev.eventDate,
        durationHours: ev.durationHours,
        location: ev.location,
        attendees: ev.attendees,
        inviteSent: ev.inviteSent,
        notes: ev.notes,
        parentEventId: ev.parentEventId,
        inviteStatus: ev.inviteStatus,
        outlookEventId: ev.outlookEventId,
        outlookEventLink: ev.outlookEventLink,
        inviteBodyHtml: ev.inviteBodyHtml,
        inviteEmails: ev.inviteEmails,
        restringirReenvio: ev.restringirReenvio ?? false,
        hasZoom: zoomByEventId.get(ev.id)?.hasZoom ?? false,
        zoomNeedsUpdate: zoomByEventId.get(ev.id)?.zoomNeedsUpdate ?? false,
      })),
      boards,
      calendarBoards,
      boardObjects: pmBoardObjects,
      calendarBoardObjects: calBoardObjects,
    };
  },
});
