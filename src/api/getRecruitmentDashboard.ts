import { z } from 'zod';
import { createEndpoint, Projects, Tasks, CalendarEvents, Users, PurchaseOrders, Messages, CellValues, BoardColumns, RecruitmentRows, Boards } from '../../server/compat';

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  role: z.string(),
});

const projectSchema = z.object({
  id: z.string(),
  projectCode: z.string().optional(),
  fullName: z.string().optional(),
  status: z.string().optional(),
  client: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  team: z.array(memberSchema),
  myRole: z.string().optional(),
});

const taskSchema = z.object({
  id: z.string(),
  taskName: z.string().optional(),
  projectCode: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  endDate: z.string().optional(),
  boardName: z.string().optional(),
  statusOptions: z.array(z.string()).optional(),
});

const eventSchema = z.object({
  id: z.string(),
  eventName: z.string().optional(),
  projectCode: z.string().optional(),
  eventDate: z.string().optional(),
  location: z.string().optional(),
  calendarName: z.string().optional(),
  durationHours: z.number().optional(),
  assignedToMe: z.boolean().optional(),
});

const poCountsSchema = z.object({
  borrador: z.number(),
  enviadaAprobacion: z.number(),
  aprobada: z.number(),
  devuelta: z.number(),
  cancelada: z.number(),
  total: z.number(),
});

const mentionSchema = z.object({
  id: z.string(),
  channel: z.string().optional(),
  senderName: z.string().optional(),
  senderEmail: z.string().optional(),
  content: z.string().optional(),
  sentAt: z.string().optional(),
});

const toIds = (v: string[] | string | undefined): string[] => {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
};

const mkInitials = (u: { firstName?: string; lastName?: string; email?: string }) =>
  ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || (u.email?.[0]?.toUpperCase() ?? '?');

export default createEndpoint({
  authenticated: true,
  description: 'Get recruitment-specific dashboard data',
  inputSchema: z.object({}),
  outputSchema: z.object({
    isGlobal: z.boolean(),
    poCounts: poCountsSchema,
    recentMentions: z.array(mentionSchema),
    myProjects: z.array(projectSchema),
    myTasks: z.array(taskSchema),
    upcomingEvents: z.array(eventSchema),
  }),
  execute: async ({ context }) => {
    const user = context.user!;
    const isGlobal = ['Owner', 'Socio'].includes(user.role ?? '');
    const firstName = user.firstName ?? '';
    const lastName = user.lastName ?? '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');

    // Build mention search string
    const mentionSearch = firstName ? `@${firstName}` : `@${user.email}`;

    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Parallel phase 1: POs, messages, projects, users
    const [{ records: recruitPOs }, { records: rawMentions }, { records: allProjects }, { records: allUsers }] = await Promise.all([
      PurchaseOrders.findAll({
        filters: { category: 'Reclutamiento e Incentivos' },
        limit: 2000,
        fields: ['status', 'category'],
      }),
      Messages.findAll({
        filters: { content: { contains: mentionSearch } },
        limit: 100,
        fields: ['id', 'channel', 'senderName', 'senderEmail', 'content', 'sentAt'],
      }),
      Projects.findAll({
        limit: 500,
        fields: ['projectCode', 'fullName', 'status', 'client', 'startDate', 'endDate', 'lider', 'analistas', 'moderadores', 'asistentes'],
      }),
      Users.findAll({ limit: 200, fields: ['firstName', 'lastName', 'email'] }),
    ]);

    // PO counts grouped by status
    const poStatusMap: Record<string, number> = {};
    for (const po of recruitPOs) {
      const s = po.status ?? 'Sin estado';
      poStatusMap[s] = (poStatusMap[s] ?? 0) + 1;
    }
    const poCounts = {
      borrador: poStatusMap['Borrador'] ?? 0,
      enviadaAprobacion: poStatusMap['Enviada a aprobación'] ?? 0,
      aprobada: poStatusMap['Aprobada'] ?? 0,
      devuelta: poStatusMap['Devuelta'] ?? 0,
      cancelada: poStatusMap['Cancelada'] ?? 0,
      total: recruitPOs.length,
    };

    // Filter and sort mentions, truncate content
    const mentionPattern = fullName ? `@${fullName}` : mentionSearch;
    const recentMentions = rawMentions
      .filter(m => {
        const c = m.content ?? '';
        return c.includes(mentionPattern) || c.includes(mentionSearch);
      })
      .sort((a, b) => {
        if (!a.sentAt && !b.sentAt) return 0;
        if (!a.sentAt) return 1;
        if (!b.sentAt) return -1;
        return a.sentAt > b.sentAt ? -1 : 1;
      })
      .slice(0, 10)
      .map(m => ({
        id: m.id,
        channel: m.channel,
        senderName: m.senderName,
        senderEmail: m.senderEmail,
        content: m.content ? m.content.slice(0, 120) + (m.content.length > 120 ? '…' : '') : undefined,
        sentAt: m.sentAt,
      }));

    // Projects
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const myProjects = isGlobal
      ? allProjects
      : allProjects.filter(p => {
          const members = [
            ...toIds(p.lider),
            ...toIds(p.analistas),
            ...toIds(p.moderadores),
            ...toIds(p.asistentes),
          ];
          return members.includes(user.id);
        });

    const projectsWithTeam = myProjects.map(p => {
      const team: { id: string; name: string; initials: string; role: string }[] = [];
      const addMembers = (ids: string[], role: string) => {
        for (const id of ids) {
          const u = userMap.get(id);
          if (u) team.push({ id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '', initials: mkInitials(u), role });
        }
      };
      addMembers(toIds(p.lider), 'Líder');
      addMembers(toIds(p.analistas), 'Analista');
      addMembers(toIds(p.moderadores), 'Moderador');
      addMembers(toIds(p.asistentes), 'Asistente');

      let myRole: string | undefined;
      if (!isGlobal) {
        if (toIds(p.lider).includes(user.id)) myRole = 'Líder';
        else if (toIds(p.analistas).includes(user.id)) myRole = 'Analista';
        else if (toIds(p.moderadores).includes(user.id)) myRole = 'Moderador';
        else if (toIds(p.asistentes).includes(user.id)) myRole = 'Asistente';
      }

      return { id: p.id, projectCode: p.projectCode, fullName: p.fullName, status: p.status, client: p.client, startDate: p.startDate?.split('T')[0], endDate: p.endDate?.split('T')[0], team, myRole };
    });

    const myCodes = new Set(myProjects.map(p => p.projectCode).filter(Boolean) as string[]);

    // Phase 2: tasks, events, dynamic cells
    const [{ records: allTasks }, { records: allEvents }, { records: assignedCells }] = await Promise.all([
      Tasks.findAll({ limit: 1000, fields: ['taskName', 'projectCode', 'status', 'assignedTo', 'endDate', 'boardName', 'parentTaskId', 'boardId', 'deletedAt'] }),
      CalendarEvents.findAll({ limit: 500, fields: ['eventName', 'projectCode', 'eventDate', 'location', 'calendarName', 'durationHours'] }),
      CellValues.findAll({ filters: { textValue: user.id }, limit: 2000, fields: ['rowId', 'boardId'] }),
    ]);

    // UUID-native: batch-lookup unique boardIds against the Boards table to classify
    // by boardType instead of relying on legacy 'pm-' / 'cal-' prefixes.
    // boards.id es uuid real — filtrar antes de consultar, o Postgres truena con
    // "invalid input syntax for type uuid" en cuanto una celda trae un boardId
    // legacy sin migrar (mismo bug y mismo fix que getDashboardData.ts).
    const UUID_RE_BOARDS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uniqueBoardIds = [...new Set(assignedCells.map(c => c.boardId).filter(Boolean) as string[])]
      .filter(id => UUID_RE_BOARDS.test(id));
    const boardTypeMap = new Map<string, string>();
    if (uniqueBoardIds.length > 0) {
      for (let i = 0; i < uniqueBoardIds.length; i += 100) {
        const batch = uniqueBoardIds.slice(i, i + 100);
        const { records: boardRecords } = await Boards.findAll({
          filters: { id: { in: batch } } as any,
          limit: 100,
          fields: ['boardType'],
        });
        for (const br of boardRecords) {
          if (br.boardType) boardTypeMap.set(br.id, br.boardType);
        }
      }
    }
    const classifyBoardId = (bid: string): 'pm' | 'calendar' | 'unknown' => {
      const bt = boardTypeMap.get(bid);
      if (bt === 'pm') return 'pm';
      if (bt === 'calendar') return 'calendar';
      if (bid.startsWith('pm-')) return 'pm';
      if (bid.startsWith('cal-')) return 'calendar';
      return 'unknown';
    };

    const dynamicAssignedTaskIds = new Set<string>();
    const dynamicAssignedEventIds = new Set<string>();
    for (const cell of assignedCells) {
      const cls = classifyBoardId(cell.boardId ?? '');
      if (cls === 'calendar' && cell.rowId) dynamicAssignedEventIds.add(cell.rowId);
      if (cls === 'pm' && cell.rowId) dynamicAssignedTaskIds.add(cell.rowId);
    }

    const projectTasks = allTasks.filter(t =>
      !t.deletedAt &&
      !t.parentTaskId &&
      (isGlobal || myCodes.has(t.projectCode ?? '') || dynamicAssignedTaskIds.has(t.id))
    );

    // Phase 3: dynamic status options for task boards
    const taskBoardIdMap = new Map<string, string>();
    for (const t of projectTasks) {
      if (!t.projectCode) continue;
      // Prefer UUID boardId if available
      if ((t as any).boardId && boardTypeMap.has((t as any).boardId)) {
        taskBoardIdMap.set(t.id, (t as any).boardId);
      } else {
        taskBoardIdMap.set(t.id, t.boardName ? `pm-${t.projectCode}-${t.boardName}` : `pm-${t.projectCode}`);
      }
    }
    for (const cell of assignedCells.filter(c => classifyBoardId(c.boardId ?? '') === 'pm')) {
      if (cell.rowId && cell.boardId) taskBoardIdMap.set(cell.rowId, cell.boardId);
    }

    // Include both UUID and legacy PM board IDs
    const allPmBoardIds = [...new Set([...taskBoardIdMap.values()].filter(b => {
      if (boardTypeMap.get(b) === 'pm') return true;
      return b.startsWith('pm-') && b !== 'pm-';
    }))];
    const statusOptionsByBoard = new Map<string, string[]>();

    if (allPmBoardIds.length > 0) {
      const boardColResults = await Promise.all(
        allPmBoardIds.map(boardId =>
          BoardColumns.findAll({ filters: { boardId } as any, limit: 200, fields: ['columnName', 'columnType', 'boardId', 'optionsJson', 'deletedAt'] }).then(r => r.records)
        )
      );
      for (let i = 0; i < allPmBoardIds.length; i++) {
        const boardId = allPmBoardIds[i];
        const estadoCol = boardColResults[i].find(c => !c.deletedAt && (c.columnName ?? '').toLowerCase() === 'estado');
        if (estadoCol) {
          try {
            const raw = JSON.parse((estadoCol as any).optionsJson ?? '[]');
            const labels: string[] = raw.map((o: unknown) => typeof o === 'string' ? o : ((o as Record<string, string>).value ?? (o as Record<string, string>).label ?? '')).filter(Boolean);
            if (labels.length > 0) statusOptionsByBoard.set(boardId, labels);
          } catch { /* ignore */ }
        }
      }
    }

    const myTasks = projectTasks
      .filter(t => {
        if (dynamicAssignedTaskIds.has(t.id)) return true;
        if (!t.assignedTo) return false;
        const a = t.assignedTo.toLowerCase();
        if (firstName && a.includes(firstName.toLowerCase())) return true;
        if (lastName && a.includes(lastName.toLowerCase())) return true;
        return false;
      })
      .sort((a, b) => {
        if (!a.endDate && !b.endDate) return 0;
        if (!a.endDate) return 1;
        if (!b.endDate) return -1;
        return a.endDate < b.endDate ? -1 : 1;
      })
      .map(t => ({
        id: t.id,
        taskName: t.taskName,
        projectCode: t.projectCode,
        status: t.status,
        assignedTo: t.assignedTo,
        endDate: t.endDate?.split('T')[0],
        boardName: t.boardName,
        statusOptions: statusOptionsByBoard.get(taskBoardIdMap.get(t.id) ?? '') ?? [],
      }));

    const upcomingEvents = allEvents
      .filter(ev => {
        if (!ev.eventDate) return false;
        const d = new Date(ev.eventDate);
        if (d < now || d > in14) return false;
        return isGlobal || myCodes.has(ev.projectCode ?? '') || dynamicAssignedEventIds.has(ev.id);
      })
      .sort((a, b) => (a.eventDate ?? '') < (b.eventDate ?? '') ? -1 : 1)
      .slice(0, 20)
      .map(ev => ({
        id: ev.id,
        eventName: ev.eventName,
        projectCode: ev.projectCode,
        eventDate: ev.eventDate,
        location: ev.location,
        calendarName: ev.calendarName,
        durationHours: ev.durationHours,
        assignedToMe: dynamicAssignedEventIds.has(ev.id),
      }));

    return { isGlobal, poCounts, recentMentions, myProjects: projectsWithTeam, myTasks, upcomingEvents };
  },
});
