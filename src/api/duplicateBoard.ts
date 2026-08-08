import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns, Tasks, CellValues } from '../../server/compat';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Try the primary key first; if no active records come back, try the fallback key. */
async function dualReadColumns(primaryId: string, fallbackId: string | undefined) {
  const { records: primary } = await BoardColumns.findAll({ filters: { boardId: primaryId }, limit: 500 });
  const active = primary.filter(c => !c.deletedAt);
  if (active.length > 0 || !fallbackId || fallbackId === primaryId) return active;

  const { records: fallback } = await BoardColumns.findAll({ filters: { boardId: fallbackId }, limit: 500 });
  return fallback.filter(c => !c.deletedAt);
}

async function dualReadCells(primaryId: string, fallbackId: string | undefined) {
  const { records: primary } = await CellValues.findAll({ filters: { boardId: primaryId }, limit: 2000 });
  const active = primary.filter(c => !c.deletedAt);
  if (active.length > 0 || !fallbackId || fallbackId === primaryId) return active;

  const { records: fallback } = await CellValues.findAll({ filters: { boardId: fallbackId }, limit: 2000 });
  return fallback.filter(c => !c.deletedAt);
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

export default createEndpoint({
  authenticated: true,
  description: 'Duplicates a timeline board — columns, tasks (with parent mapping), cell values, and groups board.',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string(),
    newBoardName: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newBoardName: z.string(),
    taskCount: z.number(),
    /** The real UUID of the new Board record */
    uuidBoardId: z.string(),
    /** Legacy composite ID (pm-/cal-/recruitment- prefix) — used by frontend for cache keys */
    legacyBoardId: z.string(),
    /** Alias for uuidBoardId — canonical ID to use in future writes */
    canonicalBoardId: z.string(),
    taskColumnsCreated: z.array(z.object({
      id: z.string(),
      boardId: z.string().optional(),
      columnName: z.string().optional(),
      columnType: z.string().optional(),
      columnOrder: z.number().optional(),
      optionsJson: z.string().optional(),
    })).optional(),
    groupColumnsCreated: z.array(z.object({
      id: z.string(),
      boardId: z.string().optional(),
      columnName: z.string().optional(),
      columnType: z.string().optional(),
      columnOrder: z.number().optional(),
      optionsJson: z.string().optional(),
    })).optional(),
    taskCellValuesCreated: z.array(z.object({
      id: z.string(),
      boardId: z.string().optional(),
      rowId: z.string().optional(),
      columnId: z.string().optional(),
      textValue: z.string().optional(),
      numberValue: z.number().optional(),
      dateValue: z.string().optional(),
      booleanValue: z.boolean().optional(),
      fileUrl: z.string().optional(),
    })).optional(),
    groupCellValuesCreated: z.array(z.object({
      id: z.string(),
      boardId: z.string().optional(),
      rowId: z.string().optional(),
      columnId: z.string().optional(),
      textValue: z.string().optional(),
      numberValue: z.number().optional(),
      dateValue: z.string().optional(),
      booleanValue: z.boolean().optional(),
      fileUrl: z.string().optional(),
    })).optional(),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName, newBoardName } = input;

    // ── 0. Find source Board record to get boardType + UUID ───────────────────
    const existingBoardsEarly = await Boards.findAll({ filters: { projectCode }, limit: 200 });
    const srcBoardEarly = existingBoardsEarly.records.find(b => b.boardName === boardName && !b.deletedAt);

    const boardTypePrefix =
      srcBoardEarly?.boardType === 'calendar'    ? 'cal-' :
      srcBoardEarly?.boardType === 'recruitment' ? 'recruitment-' :
      'pm-';

    // Legacy composite IDs (source)
    const srcBoardId      = `${boardTypePrefix}${projectCode}-${boardName}`;
    const srcGroupBoardId = `${srcBoardId}::groups`;

    // Source UUID (may be undefined for boards that pre-date the Boards table)
    const srcUuid      = srcBoardEarly?.id;
    const srcUuidGroup = srcUuid ? `${srcUuid}::groups` : undefined;

    // Legacy composite IDs (destination) — used only in response for frontend cache
    const destBoardId      = `${boardTypePrefix}${projectCode}-${newBoardName}`;
    const destGroupBoardId = `${destBoardId}::groups`;

    // ── 1. Fetch source data with dual-read (legacy first, UUID fallback) ─────
    const [
      activeCols,
      activeGroupCols,
      srcTasksRes,
      activeCells,
      activeGroupCells,
      existingBoards,
    ] = await Promise.all([
      dualReadColumns(srcBoardId, srcUuid),
      dualReadColumns(srcGroupBoardId, srcUuidGroup),
      Tasks.findAll({ filters: { projectCode, boardName }, limit: 2000 }),
      dualReadCells(srcBoardId, srcUuid),
      dualReadCells(srcGroupBoardId, srcUuidGroup),
      Boards.findAll({ filters: { projectCode }, limit: 200 }),
    ]);

    // ── 2. Create new Board record — capture UUID ─────────────────────────────
    const srcBoard  = existingBoards.records.find(b => b.boardName === boardName && !b.deletedAt);
    const maxOrder  = existingBoards.records.reduce((m, b) => Math.max(m, b.boardOrder ?? 0), 0);
    const createdBoard = await Boards.create({
      record: {
        boardName: newBoardName,
        projectCode,
        boardOrder: maxOrder + 1,
        boardType: srcBoard?.boardType ?? undefined,
      },
    });

    const uuidBoardId      = createdBoard.id;
    const uuidGroupBoardId = `${uuidBoardId}::groups`;

    // ── 3. Duplicate main board columns under UUID ────────────────────────────
    const colIdMap = new Map<string, string>(); // oldId → newId
    const allTaskColsCreated: Array<{ id: string; boardId?: string; columnName?: string; columnType?: string; columnOrder?: number; optionsJson?: string }> = [];

    if (activeCols.length > 0) {
      const chunks: typeof activeCols[] = [];
      for (let i = 0; i < activeCols.length; i += 50) chunks.push(activeCols.slice(i, i + 50));

      for (const chunk of chunks) {
        const res = await BoardColumns.bulkCreate({
          records: chunk.map(c => ({
            columnName:  c.columnName,
            boardId:     uuidBoardId,   // ← write under UUID
            columnType:  c.columnType,
            optionsJson: c.optionsJson,
            columnOrder: c.columnOrder,
          })),
        });
        res.records.forEach((newRec, idx) => {
          colIdMap.set(chunk[idx].id, newRec.id);
          // Return legacy boardId so preSeedBoardCache uses the right cache key
          allTaskColsCreated.push({
            id:          newRec.id,
            boardId:     destBoardId,   // ← legacy in response
            columnName:  newRec.columnName  ?? undefined,
            columnType:  newRec.columnType  ?? undefined,
            optionsJson: newRec.optionsJson ?? undefined,
            columnOrder: newRec.columnOrder ?? undefined,
          });
        });
      }
    }

    // ── 4. Duplicate group board columns under UUID::groups ───────────────────
    const groupColIdMap = new Map<string, string>(); // oldGroupColId → newGroupColId
    const allGroupColsCreated: Array<{ id: string; boardId?: string; columnName?: string; columnType?: string; columnOrder?: number; optionsJson?: string }> = [];

    if (activeGroupCols.length > 0) {
      const chunks: typeof activeGroupCols[] = [];
      for (let i = 0; i < activeGroupCols.length; i += 50) chunks.push(activeGroupCols.slice(i, i + 50));

      for (const chunk of chunks) {
        const res = await BoardColumns.bulkCreate({
          records: chunk.map(c => ({
            columnName:  c.columnName,
            boardId:     uuidGroupBoardId,   // ← write under UUID::groups
            columnType:  c.columnType,
            optionsJson: c.optionsJson,
            columnOrder: c.columnOrder,
          })),
        });
        res.records.forEach((newRec, idx) => {
          groupColIdMap.set(chunk[idx].id, newRec.id);
          allGroupColsCreated.push({
            id:          newRec.id,
            boardId:     destGroupBoardId,   // ← legacy::groups in response
            columnName:  newRec.columnName  ?? undefined,
            columnType:  newRec.columnType  ?? undefined,
            optionsJson: newRec.optionsJson ?? undefined,
            columnOrder: newRec.columnOrder ?? undefined,
          });
        });
      }
    }

    // ── 5. Duplicate tasks (two passes for parent-child mapping) ─────────────
    const allTasks = srcTasksRes.records;
    const topLevel = allTasks.filter(t => !t.parentTaskId);
    const children  = allTasks.filter(t => !!t.parentTaskId);
    const taskIdMap = new Map<string, string>(); // oldTaskId → newTaskId

    // Pass 1: top-level tasks
    for (let i = 0; i < topLevel.length; i += 50) {
      const chunk = topLevel.slice(i, i + 50);
      const res = await Tasks.bulkCreate({
        records: chunk.map(t => ({
          taskName:   t.taskName,
          projectCode,
          boardName:  newBoardName,
          boardId:    uuidBoardId,
          status:     t.status,
          assignedTo: t.assignedTo,
          startDate:  t.startDate,
          endDate:    t.endDate,
          order:      t.order,
          notes:      t.notes,
        })),
      });
      res.records.forEach((newRec, idx) => taskIdMap.set(chunk[idx].id, newRec.id));
    }

    // Pass 2: child tasks (parentTaskId remapped)
    for (let i = 0; i < children.length; i += 50) {
      const chunk = children.slice(i, i + 50);
      const res = await Tasks.bulkCreate({
        records: chunk.map(t => ({
          taskName:     t.taskName,
          projectCode,
          boardName:    newBoardName,
          boardId:      uuidBoardId,
          status:       t.status,
          assignedTo:   t.assignedTo,
          startDate:    t.startDate,
          endDate:      t.endDate,
          order:        t.order,
          notes:        t.notes,
          parentTaskId: taskIdMap.get(t.parentTaskId!) ?? undefined,
        })),
      });
      res.records.forEach((newRec, idx) => taskIdMap.set(chunk[idx].id, newRec.id));
    }

    // ── 6. Duplicate main board cell values under UUID ────────────────────────
    const mappableCells = activeCells.filter(
      c => c.rowId && taskIdMap.has(c.rowId) && c.columnId && colIdMap.has(c.columnId)
    );
    const allTaskCellsCreated: Array<{ id: string; boardId?: string; rowId?: string; columnId?: string; textValue?: string; numberValue?: number; dateValue?: string; booleanValue?: boolean; fileUrl?: string }> = [];

    for (let i = 0; i < mappableCells.length; i += 100) {
      const chunk = mappableCells.slice(i, i + 100);
      const res = await CellValues.bulkCreate({
        records: chunk.map(c => ({
          boardId:      uuidBoardId,                 // ← write under UUID
          rowId:        taskIdMap.get(c.rowId!)!,
          columnId:     colIdMap.get(c.columnId!)!,
          textValue:    c.textValue,
          numberValue:  c.numberValue,
          dateValue:    c.dateValue,
          booleanValue: c.booleanValue,
          fileUrl:      c.fileUrl,
        })),
      });
      res.records.forEach(r => allTaskCellsCreated.push({
        id:           r.id,
        boardId:      destBoardId,                   // ← legacy in response
        rowId:        r.rowId       ?? undefined,
        columnId:     r.columnId    ?? undefined,
        textValue:    r.textValue   ?? undefined,
        numberValue:  r.numberValue ?? undefined,
        dateValue:    r.dateValue   ?? undefined,
        booleanValue: r.booleanValue ?? undefined,
        fileUrl:      r.fileUrl     ?? undefined,
      }));
    }

    // ── 7. Duplicate group board cell values under UUID::groups ───────────────
    const mappableGroupCells = activeGroupCells.filter(
      c => c.rowId && taskIdMap.has(c.rowId) && c.columnId && groupColIdMap.has(c.columnId)
    );
    const allGroupCellsCreated: Array<{ id: string; boardId?: string; rowId?: string; columnId?: string; textValue?: string; numberValue?: number; dateValue?: string; booleanValue?: boolean; fileUrl?: string }> = [];

    for (let i = 0; i < mappableGroupCells.length; i += 100) {
      const chunk = mappableGroupCells.slice(i, i + 100);
      const res = await CellValues.bulkCreate({
        records: chunk.map(c => ({
          boardId:      uuidGroupBoardId,                 // ← write under UUID::groups
          rowId:        taskIdMap.get(c.rowId!)!,
          columnId:     groupColIdMap.get(c.columnId!)!,
          textValue:    c.textValue,
          numberValue:  c.numberValue,
          dateValue:    c.dateValue,
          booleanValue: c.booleanValue,
          fileUrl:      c.fileUrl,
        })),
      });
      res.records.forEach(r => allGroupCellsCreated.push({
        id:           r.id,
        boardId:      destGroupBoardId,                   // ← legacy::groups in response
        rowId:        r.rowId       ?? undefined,
        columnId:     r.columnId    ?? undefined,
        textValue:    r.textValue   ?? undefined,
        numberValue:  r.numberValue ?? undefined,
        dateValue:    r.dateValue   ?? undefined,
        booleanValue: r.booleanValue ?? undefined,
        fileUrl:      r.fileUrl     ?? undefined,
      }));
    }

    return {
      success: true,
      newBoardName,
      taskCount: allTasks.length,
      uuidBoardId,
      legacyBoardId:   destBoardId,
      canonicalBoardId: uuidBoardId,
      taskColumnsCreated:    allTaskColsCreated,
      groupColumnsCreated:   allGroupColsCreated,
      taskCellValuesCreated: allTaskCellsCreated,
      groupCellValuesCreated: allGroupCellsCreated,
    };
  },
});
