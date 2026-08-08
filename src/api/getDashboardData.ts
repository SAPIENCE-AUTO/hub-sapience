import { z } from 'zod';
import { createEndpoint, Projects, Tasks, CalendarEvents, Users, RecruitmentRows, PurchaseOrders, CellValues, BoardColumns, Boards } from '../../server/compat';

// ---------------------------------------------------------------------------
// Module-level inflight deduplication (per user + input)
// Prevents duplicate queries from React StrictMode double-invocations or
// rapid re-navigation by the same user.
// ---------------------------------------------------------------------------
type DashboardOutput = {
  isGlobal: boolean;
  myProjects: unknown[];
  myTasks: unknown[];
  upcomingEvents: unknown[];
  taskStats: { total: number; pending: number; inProgress: number; completed: number; blocked: number };
  kpis: { confirmedParticipants: number; completedTasks: number; totalPOAmount: number; activeProjects: number };
};
const inflightRequests = new Map<string, Promise<DashboardOutput>>();

// Short-lived result cache: prevents hammering the DB if the same user triggers
// multiple calls within CACHE_TTL_MS (e.g. React StrictMode, user object re-renders)
const CACHE_TTL_MS = 300_000; // 5 minutes
type CacheEntry = { result: DashboardOutput; expiresAt: number };
const resultCache = new Map<string, CacheEntry>();

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

const toIds = (v: string[] | string | undefined): string[] => {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
};

// ---------------------------------------------------------------------------
// Concurrency limiter — runs `fn` on each item, at most `limit` at a time
// ---------------------------------------------------------------------------
async function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export default createEndpoint({
  authenticated: true,
  description: 'Get personalized dashboard data for the current user',
  inputSchema: z.object({
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({
    isGlobal: z.boolean(),
    myProjects: z.array(projectSchema),
    myTasks: z.array(taskSchema),
    upcomingEvents: z.array(eventSchema),
    taskStats: z.object({
      total: z.number(),
      pending: z.number(),
      inProgress: z.number(),
      completed: z.number(),
      blocked: z.number(),
    }),
    kpis: z.object({
      confirmedParticipants: z.number(),
      completedTasks: z.number(),
      totalPOAmount: z.number(),
      activeProjects: z.number(),
    }),
  }),
  execute: async ({ input, context }) => {
    const user = context.user!;
    const cacheKey = `${user.id}:${JSON.stringify(input)}`;

    // Return cached result if still fresh
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('[getDashboardData] cache hit', { cacheKey, ttlLeft: Math.round((cached.expiresAt - Date.now()) / 1000) + 's' });
      return cached.result as unknown as Awaited<ReturnType<typeof buildDashboard>>;
    }

    // If there is already a request in-flight for this exact user+input, await it
    const existing = inflightRequests.get(cacheKey);
    if (existing) {
      console.log('[getDashboardData] awaiting inflight', { cacheKey });
      return existing as ReturnType<typeof buildDashboard>;
    }

    console.log('[getDashboardData] start', { userId: user.id, input });

    const promise = buildDashboard(input, user);
    inflightRequests.set(cacheKey, promise as Promise<DashboardOutput>);

    try {
      const result = await promise;
      // Cache the result
      resultCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  },
});

// ---------------------------------------------------------------------------
// Core logic extracted so the inflight map can hold the promise cleanly
// ---------------------------------------------------------------------------
async function buildDashboard(
  input: { projectCode?: string },
  user: {
    id: string;
    role?: string;
    firstName?: string;
    lastName?: string;
  },
) {
  const t0 = Date.now();
  const isGlobal = ['Owner', 'Socio'].includes(user.role ?? '');
  const firstName = user.firstName ?? '';
  const lastName = user.lastName ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  const mkInitials = (u: { firstName?: string; lastName?: string; email?: string }) =>
    ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || (u.email?.[0]?.toUpperCase() ?? '?');

  // ── Phase 1: projects + users ────────────────────────────────────────────
  const [{ records: allProjects }, { records: allUsers }] = await Promise.all([
    Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'fullName', 'status', 'client', 'startDate', 'endDate', 'lider', 'analistas', 'moderadores', 'asistentes'],
    }),
    Users.findAll({ limit: 200, fields: ['firstName', 'lastName', 'email'] }),
  ]);
  console.log('[getDashboardData] phase1 done', { ms: Date.now() - t0, projects: allProjects.length });

  const userMap = new Map(allUsers.map(u => [u.id, u]));

  const scopedProjects = allProjects.filter(p =>
    !input.projectCode || p.projectCode === input.projectCode
  );

  const myProjects = isGlobal
    ? scopedProjects
    : scopedProjects.filter(p => {
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
        if (u) team.push({
          id,
          name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '',
          initials: mkInitials(u),
          role,
        });
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

    return {
      id: p.id,
      projectCode: p.projectCode,
      fullName: p.fullName,
      status: p.status,
      client: p.client,
      startDate: p.startDate?.split('T')[0],
      endDate: p.endDate?.split('T')[0],
      team,
      myRole,
    };
  });

  const myCodes = new Set(myProjects.map(p => p.projectCode).filter(Boolean) as string[]);

  // ── Phase 2: tasks, events, rows, POs, assigned cells ───────────────────
  // Fully sequential to avoid bursting the DB rate limit.
  // Each findAll with large limits internally paginates (e.g. limit:2000 → 4 requests),
  // so even 2 parallel queries can exceed the 50 req/s ceiling.
  const t2 = Date.now();
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Small delay between each large sequential query to avoid DB rate limit spikes
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const { records: allTasks } = await Tasks.findAll({ limit: 1000, fields: ['taskName', 'projectCode', 'status', 'assignedTo', 'endDate', 'boardName', 'parentTaskId', 'boardId'] });
  await sleep(300);
  const { records: assignedCells } = await CellValues.findAll({ filters: { textValue: user.id }, limit: 2000, fields: ['rowId', 'boardId'] });
  await sleep(300);
  const { records: allEvents } = await CalendarEvents.findAll({ limit: 500, fields: ['eventName', 'projectCode', 'eventDate', 'location', 'calendarName', 'durationHours'] });
  await sleep(300);
  const { records: rows } = await RecruitmentRows.findAll({ limit: 2000, fields: ['projectCode', 'status'] });
  await sleep(300);
  const { records: pos } = await PurchaseOrders.findAll({ limit: 1000, fields: ['projectCode', 'totalAmount', 'status'] });
  console.log('[getDashboardData] phase2 done', { ms: Date.now() - t2, tasks: allTasks.length, events: allEvents.length });

  const phase2DurationMs = Date.now() - t0;
  if (phase2DurationMs > 10000) {
    console.warn('[getDashboardData] skipping Phase 3 due to duration guard', { phase2DurationMs });
  }

  // Build set of task/event IDs assigned via dynamic columns.
  // UUID-native: batch-lookup unique boardIds against the Boards table to classify
  // by boardType instead of relying on legacy 'pm-' / 'cal-' prefixes.
  const dynamicAssignedTaskIds = new Set<string>();
  const dynamicAssignedEventIds = new Set<string>();

  // boards.id es uuid real — filtrar antes de consultar, o Postgres truena con
  // "invalid input syntax for type uuid" en cuanto una celda trae un boardId
  // legacy (cal-/pm-) sin migrar. classifyBoardId ya tiene su propio fallback
  // por prefijo para esos casos, así que no se pierde nada al excluirlos aquí.
  const UUID_RE_BOARDS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uniqueBoardIds = [...new Set(assignedCells.map(c => c.boardId).filter(Boolean) as string[])]
    .filter(id => UUID_RE_BOARDS.test(id));
  const boardTypeMap = new Map<string, string>(); // boardId → 'pm' | 'calendar' | ...

  if (uniqueBoardIds.length > 0) {
    // Fetch boards in batches of 100 to stay within limits
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

  // Classify each cell: use Board.boardType when available, fall back to legacy prefix
  const classifyBoardId = (bid: string): 'pm' | 'calendar' | 'unknown' => {
    const bt = boardTypeMap.get(bid);
    if (bt === 'pm') return 'pm';
    if (bt === 'calendar') return 'calendar';
    // Legacy fallback for boardIds not found in Boards table
    if (bid.startsWith('pm-')) return 'pm';
    if (bid.startsWith('cal-')) return 'calendar';
    return 'unknown';
  };

  const pmAssignedCells = assignedCells.filter(c => classifyBoardId(c.boardId ?? '') === 'pm');
  const calAssignedCells = assignedCells.filter(c => classifyBoardId(c.boardId ?? '') === 'calendar');
  for (const cell of calAssignedCells) {
    if (cell.rowId) dynamicAssignedEventIds.add(cell.rowId);
  }
  for (const cell of pmAssignedCells) {
    if (cell.rowId) dynamicAssignedTaskIds.add(cell.rowId);
  }

  // Top-level tasks only
  const projectTasks = allTasks.filter(t =>
    !t.parentTaskId &&
    (isGlobal || myCodes.has(t.projectCode ?? '') || dynamicAssignedTaskIds.has(t.id)) &&
    (!input.projectCode || t.projectCode === input.projectCode)
  );

  // ── Phase 3: resolve dynamic task status via BoardColumns + CellValues ───
  const dynamicTaskStatus = new Map<string, string>();
  const statusOptionsByBoard = new Map<string, string[]>();
  const taskBoardIdMap = new Map<string, string>();
  let pmBoardCount = 0;

  if (phase2DurationMs <= 10000) {
  const t3 = Date.now();
  // Build a reverse map: projectCode+boardName → UUID from the Boards we already fetched
  const boardUUIDLookup = new Map<string, string>(); // "projectCode::boardName" → UUID
  for (const [bid, bt] of boardTypeMap.entries()) {
    if (bt === 'pm') boardUUIDLookup.set(bid, bid); // UUID boards map to themselves
  }

  for (const t of projectTasks) {
    if (!t.projectCode) continue;
    // If the task has a boardId (UUID), prefer that
    if ((t as any).boardId && boardTypeMap.has((t as any).boardId)) {
      taskBoardIdMap.set(t.id, (t as any).boardId);
    } else {
      const bid = t.boardName ? `pm-${t.projectCode}-${t.boardName}` : `pm-${t.projectCode}`;
      taskBoardIdMap.set(t.id, bid);
    }
  }
  for (const cell of pmAssignedCells) {
    if (cell.rowId && cell.boardId) taskBoardIdMap.set(cell.rowId, cell.boardId);
  }

  // Include all PM board IDs — both UUIDs and legacy prefixed ones
  let allPmBoardIds = [...new Set([...taskBoardIdMap.values()].filter(b => {
    // UUID boards (from Boards table) or legacy 'pm-' prefix
    if (boardTypeMap.get(b) === 'pm') return true;
    return b.startsWith('pm-') && b !== 'pm-';
  }))];

  // Smart board cap: limit to 10 boards, prioritizing boards with tasks
  if (allPmBoardIds.length > 10) {
    const activeBoardIds = new Set<string>();
    for (const [, bid] of taskBoardIdMap) {
      activeBoardIds.add(bid);
    }
    const active = allPmBoardIds.filter(b => activeBoardIds.has(b));
    const inactive = allPmBoardIds.filter(b => !activeBoardIds.has(b));
    const cappedBoardIds = [...active, ...inactive].slice(0, 10);
    console.warn('[getDashboardData] Phase 3 board cap applied', { totalBoards: allPmBoardIds.length, processedBoards: cappedBoardIds.length, skippedBoards: allPmBoardIds.length - cappedBoardIds.length });
    allPmBoardIds = cappedBoardIds;
  }

  if (allPmBoardIds.length > 0) {
    // Load BoardColumns sequentially with small delays to avoid rate limits
    const boardColResults = await limitConcurrency(
      allPmBoardIds,
      1,
      async (boardId) => {
        await new Promise(r => setTimeout(r, 200));
        return BoardColumns.findAll({
          filters: { boardId } as any,
          limit: 200,
          fields: ['columnName', 'columnType', 'boardId', 'columnOrder', 'optionsJson', 'deletedAt'],
        }).then(r => r.records);
      },
    );

    // Map boardId → estadoColumnId + statusOptions
    const estadoColByBoard = new Map<string, string>();
    for (let i = 0; i < allPmBoardIds.length; i++) {
      const boardId = allPmBoardIds[i];
      const cols = boardColResults[i];
      const estadoCol = cols.find(c => !c.deletedAt && (c.columnName ?? '').toLowerCase() === 'estado');
      if (estadoCol) {
        estadoColByBoard.set(boardId, estadoCol.id);
        try {
          const raw = JSON.parse((estadoCol as any).optionsJson ?? '[]');
          const labels: string[] = raw
            .map((o: unknown) => typeof o === 'string' ? o : ((o as Record<string, string>).value ?? (o as Record<string, string>).label ?? ''))
            .filter(Boolean);
          if (labels.length > 0) statusOptionsByBoard.set(boardId, labels);
        } catch { /* ignore parse errors */ }
      }
    }

    // Load status CellValues sequentially with small delays
    const dynamicBoardIds = allPmBoardIds.filter(bid => estadoColByBoard.has(bid) && dynamicAssignedTaskIds.size > 0);
    if (dynamicBoardIds.length > 0) {
      const statusCellResults = await limitConcurrency(
        dynamicBoardIds,
        1,
        async (boardId) => {
          await new Promise(r => setTimeout(r, 200));
          return CellValues.findAll({
            filters: { boardId, columnId: estadoColByBoard.get(boardId) } as any,
            limit: 2000,
            fields: ['rowId', 'textValue'],
          }).then(r => r.records);
        },
      );
      for (const cells of statusCellResults) {
        for (const cell of cells) {
          if (cell.rowId && cell.textValue && dynamicAssignedTaskIds.has(cell.rowId)) {
            dynamicTaskStatus.set(cell.rowId, cell.textValue);
          }
        }
      }
    }
  }
  pmBoardCount = allPmBoardIds.length;
  console.log('[getDashboardData] phase3 done', { pmBoards: pmBoardCount, ms: Date.now() - t3 });
  } // end phase2DurationMs guard

  // ── Build final response ─────────────────────────────────────────────────
  const myTasks = projectTasks.filter(t => {
    if (dynamicAssignedTaskIds.has(t.id)) return true;
    if (!t.assignedTo) return false;
    const a = t.assignedTo.toLowerCase();
    if (firstName && a.includes(firstName.toLowerCase())) return true;
    if (lastName && a.includes(lastName.toLowerCase())) return true;
    if (fullName && a.includes(fullName.toLowerCase())) return true;
    return false;
  }).sort((a, b) => {
    if (!a.endDate && !b.endDate) return 0;
    if (!a.endDate) return 1;
    if (!b.endDate) return -1;
    return a.endDate < b.endDate ? -1 : 1;
  }).map(t => ({
    id: t.id,
    taskName: t.taskName,
    projectCode: t.projectCode,
    status: t.status || dynamicTaskStatus.get(t.id) || undefined,
    assignedTo: t.assignedTo,
    endDate: t.endDate?.split('T')[0],
    boardName: t.boardName,
    statusOptions: statusOptionsByBoard.get(taskBoardIdMap.get(t.id) ?? '') ?? [],
  }));

  const taskStats = {
    total: myTasks.length,
    pending: myTasks.filter(t => t.status === 'Pendiente').length,
    inProgress: myTasks.filter(t => t.status === 'En progreso').length,
    completed: myTasks.filter(t => t.status === 'Completada').length,
    blocked: myTasks.filter(t => t.status === 'Bloqueada').length,
  };

  const upcomingEvents = allEvents
    .filter(ev => {
      if (!ev.eventDate) return false;
      const d = new Date(ev.eventDate);
      if (d < now || d > in14) return false;
      const inMyProject = myCodes.has(ev.projectCode ?? '');
      const assignedToMe = dynamicAssignedEventIds.has(ev.id);
      if (!isGlobal && !inMyProject && !assignedToMe) return false;
      if (input.projectCode && ev.projectCode !== input.projectCode) return false;
      return true;
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

  const kpiRows = rows.filter(r => isGlobal || myCodes.has(r.projectCode ?? ''));
  const kpiPOs = pos.filter(p => isGlobal || myCodes.has((p as any).projectCode ?? ''));

  const kpis = {
    confirmedParticipants: kpiRows.filter(r => r.status === 'Confirmado' || r.status === 'Asistió').length,
    completedTasks: projectTasks.filter(t => t.status === 'Completada').length,
    totalPOAmount: kpiPOs.reduce((s, p) => s + ((p as any).totalAmount ?? 0), 0),
    activeProjects: isGlobal
      ? allProjects.filter(p => p.status === 'En curso').length
      : myProjects.filter(p => p.status === 'En curso').length,
  };

  const msTotal = Date.now() - t0;
  console.log('[getDashboardData] done', {
    msTotal,
    durationMs: msTotal,
    pmBoards: pmBoardCount,
    tasks: myTasks.length,
    events: upcomingEvents.length,
    projects: projectsWithTeam.length,
  });

  return { isGlobal, myProjects: projectsWithTeam, myTasks, upcomingEvents, taskStats, kpis };
}
