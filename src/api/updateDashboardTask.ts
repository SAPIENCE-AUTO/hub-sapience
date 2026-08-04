import { z } from 'zod';
import { createEndpoint, Tasks, CellValues, BoardColumns } from 'zite-integrations-backend-sdk';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createEndpoint({
  authenticated: true,
  description: 'Update task status or end date directly from the dashboard. UUID-first writes via smartWriteCellValue.',
  inputSchema: z.object({
    taskId: z.string(),
    newStatus: z.string().optional(),
    newEndDate: z.string().optional(), // YYYY-MM-DD
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.string().optional(),
    endDate: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const { taskId, newStatus, newEndDate } = input;

    // Fetch task to know projectCode and boardName
    const task = await Tasks.findOne({ id: taskId });
    if (!task) throw new Error('Task not found');

    // ── Resolve boardId: UUID-first ──────────────────────────────────────────
    // Fallback 1: use task.boardId directly (UUID from DB)
    let detectedBoardId = (task as any).boardId ?? '';

    // Fallback 2: detect from existing CellValue
    if (!detectedBoardId) {
      const cellRes = await CellValues.findAll({ filters: { rowId: taskId } as any, limit: 1, fields: ['boardId'] });
      detectedBoardId = cellRes.records[0]?.boardId ?? '';
    }

    // Fallback 3: legacy composite
    if (!detectedBoardId) {
      const pc = task.projectCode ?? '';
      const bn = task.boardName;
      detectedBoardId = bn ? `pm-${pc}-${bn}` : `pm-${pc}`;
    }

    // 3. Resolve to UUID via resolveWriteBoardId
    const resolution = await resolveWriteBoardId(detectedBoardId, {
      projectCode: task.projectCode ?? undefined,
      boardName: task.boardName ?? undefined,
      boardType: 'pm',
    });
    const writeBoardId = resolution.writeBoardId;
    const legacyBoardId = resolution.legacyBoardId;

    if (resolution.reason === 'legacy-fallback' || resolution.reason === 'input-passthrough') {
      console.warn('[updateDashboardTask] legacy fallback', {
        detectedBoardId,
        reason: resolution.reason,
        taskId,
      });
    }

    // ── Dual-read BoardColumns: UUID + legacy ────────────────────────────────
    const { records: primaryCols } = await BoardColumns.findAll({
      filters: { boardId: writeBoardId } as any,
      limit: 200,
      fields: ['columnName', 'columnType', 'columnOrder', 'deletedAt'],
    });
    let allCols = primaryCols.filter(c => !c.deletedAt);

    if (legacyBoardId && legacyBoardId !== writeBoardId) {
      const { records: legacyCols } = await BoardColumns.findAll({
        filters: { boardId: legacyBoardId } as any,
        limit: 200,
        fields: ['columnName', 'columnType', 'columnOrder', 'deletedAt'],
      });
      const existingNames = new Set(allCols.map(c => (c.columnName ?? '').toLowerCase()));
      for (const lc of legacyCols) {
        if (!lc.deletedAt && lc.columnName && !existingNames.has(lc.columnName.toLowerCase())) {
          allCols.push(lc);
          existingNames.add(lc.columnName.toLowerCase());
        }
      }
    }

    let updatedStatus: string | undefined = task.status ?? undefined;
    let updatedEndDate: string | undefined = task.endDate?.split('T')[0];

    // ── Update status via smartWriteCellValue ─────────────────────────────────
    if (newStatus !== undefined) {
      const estadoCol = allCols.find(c => (c.columnName ?? '').toLowerCase() === 'estado');
      if (estadoCol) {
        await smartWriteCellValue({
          uuidBoardId: writeBoardId,
          legacyBoardId,
          rowId: taskId,
          columnId: estadoCol.id,
          values: { textValue: newStatus },
          isEmpty: false,
        });
      }
      // Also update native Tasks.status for consistency
      await Tasks.update({ id: taskId, record: { status: newStatus } });
      updatedStatus = newStatus;
    }

    // ── Update end date via smartWriteCellValue ───────────────────────────────
    if (newEndDate !== undefined) {
      // Update Tasks.endDate native field
      await Tasks.update({ id: taskId, record: { endDate: newEndDate } });
      updatedEndDate = newEndDate;

      // Also update the 2nd Fecha column's CellValue (per saveCellValue convention)
      const fechaCols = allCols
        .filter(c => c.columnType === 'Fecha')
        .sort((a, b) => (a.columnOrder ?? 9999) - (b.columnOrder ?? 9999));
      const endDateCol = fechaCols[1] ?? fechaCols[0];
      if (endDateCol) {
        await smartWriteCellValue({
          uuidBoardId: writeBoardId,
          legacyBoardId,
          rowId: taskId,
          columnId: endDateCol.id,
          values: { dateValue: newEndDate },
          isEmpty: false,
        });
      }
    }

    return { success: true, status: updatedStatus, endDate: updatedEndDate };
  },
});
