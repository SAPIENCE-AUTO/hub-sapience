import { z } from 'zod';
import { createEndpoint, Tasks, BoardColumns, CellValues, Boards, Projects } from 'zite-integrations-backend-sdk';

const taskSchema = z.object({
  id: z.string(),
  taskName: z.string().optional(),
  projectCode: z.string().optional(),
  boardName: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  parentTaskId: z.string().optional(),
  taskColor: z.string().optional(),
  colorColumnId: z.string().optional(),
  startColumnId: z.string().optional(),
  endColumnId: z.string().optional(),
  boardId: z.string().optional(),
  groupName: z.string().optional(),
  groupColorId: z.string().optional(),
});

// ── Pagination helper ─────────────────────────────────────────────────────────
const PAGE_SIZE = 2000;
const MAX_PAGES = 50;

async function fetchAll<T>(
  label: string,
  findAllFn: (params: { limit: number; offset: number; fields?: string[]; [key: string]: any }) => Promise<{ records: T[]; hasMore: boolean }>,
  opts: Record<string, any> = {}
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const t0 = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await findAllFn({ ...opts, limit: PAGE_SIZE, offset });
    const records = res?.records ?? [];
    all.push(...records);
    console.log('[getTasksForGantt][fetchAll]', {
      label,
      page,
      offset,
      count: records.length,
      total: all.length,
      hasMore: res?.hasMore,
      ms: Date.now() - t0,
    });
    if (!res?.hasMore) return all;
    offset += PAGE_SIZE;
  }
  throw new Error(`Pagination safety stop: ${label} fetched ${all.length} records`);
}

export default createEndpoint({
  authenticated: true,
  description: 'Get all tasks with dates, group info, and colorColumnId for Gantt.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    tasks: z.array(taskSchema),
    projectStatuses: z.record(z.string(), z.string()),
  }),
  execute: async () => {
    try {
      // ── Phase 1: Load everything except CellValues ──────────────────────────
      const [tasks, boards, projects, cols] = await Promise.all([
        fetchAll('Tasks',        (p) => Tasks.findAll(p)),
        fetchAll('Boards',       (p) => Boards.findAll(p)),
        fetchAll('Projects',     (p) => Projects.findAll(p), { fields: ['projectCode', 'status'] }),
        fetchAll('BoardColumns', (p) => BoardColumns.findAll(p)),
      ]);

      console.log('[getTasksForGantt] phase1 counts', {
        tasks: tasks.length,
        boards: boards.length,
        projects: projects.length,
        boardColumns: cols.length,
      });

      // ── Project status map ──────────────────────────────────────────────────
      const projectStatuses: Record<string, string> = {};
      for (const p of projects) {
        if (p.projectCode && p.status) projectStatuses[p.projectCode] = p.status;
      }

      // ── Active pm-type board keys ───────────────────────────────────────────
      const NON_PM_TYPES = new Set(['calendar']);
      const pmBoardKeys      = new Set<string>();
      const deletedBoardKeys = new Set<string>();
      for (const b of boards) {
        const key = `${b.projectCode}::${b.boardName}`;
        if (b.deletedAt) {
          deletedBoardKeys.add(key);
        } else if (!b.boardType || b.boardType === 'pm' || !NON_PM_TYPES.has(b.boardType)) {
          pmBoardKeys.add(key);
        }
      }

      // ── Build set of active (non-deleted) board UUIDs for direct validation ──
      const activeBoardUUIDs = new Set<string>();
      for (const b of boards) {
        if (!b.deletedAt && (!b.boardType || b.boardType === 'pm' || !NON_PM_TYPES.has(b.boardType))) {
          activeBoardUUIDs.add(b.id);
        }
      }

      // ── Filter tasks to active pm boards ───────────────────────────────────
      const validTasks = tasks.filter(t => {
        // UUID-first: if task has a boardId UUID, validate it directly
        if (t.boardId && activeBoardUUIDs.has(t.boardId)) return true;
        // Legacy fallback: validate via composite key
        return (
          t.boardName &&
          t.projectCode &&
          !deletedBoardKeys.has(`${t.projectCode}::${t.boardName}`) &&
          pmBoardKeys.has(`${t.projectCode}::${t.boardName}`)
        );
      });

      // Build the set of relevant boardIds from valid tasks (UUID-first)
      const relevantBoardIds = new Set<string>();
      for (const t of validTasks) {
        // Use task.boardId (UUID) when it exists and points to an active board
        const bid = (t.boardId && activeBoardUUIDs.has(t.boardId))
          ? t.boardId
          : `pm-${t.projectCode}-${t.boardName}`;
        relevantBoardIds.add(bid);
        relevantBoardIds.add(`${bid}::groups`);
      }

      console.log('[getTasksForGantt] relevantBoardIds', relevantBoardIds.size);

      // ── Phase 2: Fetch CellValues filtered to relevant boards only ──────────
      const relevantBoardIdArray = [...relevantBoardIds];
      const cells = relevantBoardIdArray.length > 0
        ? await fetchAll('CellValues', (p) => CellValues.findAll(p), {
            filters: { boardId: { in: relevantBoardIdArray } },
          })
        : [];

      console.log('[getTasksForGantt] cellValues fetched', cells.length);

      // ── Filter columns and cells to only relevant pm boards ─────────────────
      const activeCols = cols
        .filter(c => !c.deletedAt && c.boardId && relevantBoardIds.has(c.boardId))
        .sort((a, b) => (a.columnOrder ?? 9999) - (b.columnOrder ?? 9999));

      const activeCells = cells
        .filter(c => !c.deletedAt && c.boardId && relevantBoardIds.has(c.boardId));

      // ── Resolve date + color columns per boardId ────────────────────────────
      const START_NAMES = new Set(['inicio', 'start', 'fecha inicio', 'start date', 'fecha_inicio']);
      const END_NAMES   = new Set(['fin', 'end', 'fecha fin', 'end date', 'fecha_fin']);

      const boardFechaMap = new Map<string, typeof activeCols>();
      for (const col of activeCols) {
        if (!col.boardId || col.columnType !== 'Fecha') continue;
        if (!boardFechaMap.has(col.boardId)) boardFechaMap.set(col.boardId, []);
        boardFechaMap.get(col.boardId)!.push(col);
      }

      const boardDateCols = new Map<string, { startColId?: string; endColId?: string; colorColId?: string }>();

      for (const [boardId, fechaCols] of boardFechaMap) {
        const entry: { startColId?: string; endColId?: string; colorColId?: string } = {};

        const startByName = fechaCols.find(c => START_NAMES.has((c.columnName ?? '').toLowerCase().trim()));
        const endByName   = fechaCols.find(c => END_NAMES.has((c.columnName ?? '').toLowerCase().trim()));
        if (startByName) entry.startColId = startByName.id;
        if (endByName)   entry.endColId   = endByName.id;

        if (!entry.startColId && !entry.endColId) {
          if (fechaCols[0]) entry.startColId = fechaCols[0].id;
          if (fechaCols[1]) entry.endColId   = fechaCols[1].id;
        } else if (entry.startColId && !entry.endColId) {
          const fb = fechaCols.find(c => c.id !== entry.startColId);
          if (fb) entry.endColId = fb.id;
        } else if (!entry.startColId && entry.endColId) {
          const fb = fechaCols.find(c => c.id !== entry.endColId);
          if (fb) entry.startColId = fb.id;
        }

        boardDateCols.set(boardId, entry);
      }

      // Color columns
      for (const col of activeCols) {
        if (!col.boardId || col.columnType !== 'Color') continue;
        const entry = boardDateCols.get(col.boardId) ?? {};
        if (!entry.colorColId) { entry.colorColId = col.id; boardDateCols.set(col.boardId, entry); }
      }

      // ── Group column info from ::groups boards ──────────────────────────────
      const groupColInfo = new Map<string, { name: string; colorId: string }>();
      for (const col of activeCols) {
        if (!col.boardId?.endsWith('::groups')) continue;
        if (!col.id || !col.columnName) continue;
        groupColInfo.set(col.id, { name: col.columnName, colorId: col.columnType ?? '' });
      }

      // ── Build color + group map from cells ──────────────────────────────────
      const cellMap = new Map<string, { color?: string; groupColId?: string }>();

      for (const cell of activeCells) {
        if (!cell.rowId || !cell.columnId || !cell.boardId) continue;

        if (cell.boardId.endsWith('::groups')) {
          if (cell.textValue === '1' && groupColInfo.has(cell.columnId)) {
            const entry = cellMap.get(cell.rowId) ?? {};
            entry.groupColId = cell.columnId;
            cellMap.set(cell.rowId, entry);
          }
          continue;
        }

        const dateCols = boardDateCols.get(cell.boardId);
        if (!dateCols?.colorColId) continue;
        if (cell.columnId === dateCols.colorColId && cell.textValue) {
          const entry = cellMap.get(cell.rowId) ?? {};
          entry.color = cell.textValue;
          cellMap.set(cell.rowId, entry);
        }
      }

      // ── Map tasks to output ─────────────────────────────────────────────────
      const outputTasks = validTasks.map(t => {
        const cell      = cellMap.get(t.id);
        // UUID-first: use task.boardId when it points to an active board
        const boardId   = (t.boardId && activeBoardUUIDs.has(t.boardId))
          ? t.boardId
          : `pm-${t.projectCode}-${t.boardName}`;
        const dateCols  = boardDateCols.get(boardId);
        const groupInfo = cell?.groupColId ? groupColInfo.get(cell.groupColId) : undefined;

        return {
          id: t.id,
          taskName:      t.taskName      ?? undefined,
          projectCode:   t.projectCode   ?? undefined,
          boardName:     t.boardName     ?? undefined,
          status:        t.status        ?? undefined,
          assignedTo:    t.assignedTo    ?? undefined,
          parentTaskId:  t.parentTaskId  ?? undefined,
          startDate: t.startDate?.split('T')[0] ?? undefined,
          endDate:   t.endDate?.split('T')[0]   ?? undefined,
          taskColor: cell?.color ?? undefined,
          colorColumnId: dateCols?.colorColId ?? undefined,
          startColumnId: dateCols?.startColId ?? undefined,
          endColumnId:   dateCols?.endColId   ?? undefined,
          boardId,
          groupName:    groupInfo?.name    ?? undefined,
          groupColorId: groupInfo?.colorId ?? undefined,
        };
      });

      return { tasks: outputTasks, projectStatuses };

    } catch (error) {
      console.error('[getTasksForGantt] failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },
});
