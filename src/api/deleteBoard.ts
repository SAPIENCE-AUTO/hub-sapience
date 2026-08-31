import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Tasks, BoardColumns, CellValues, Boards, CalendarEvents } from '../../server/compat';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Retry a single operation with exponential backoff on rate-limit errors
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate');
      if (!isRateLimit || i === attempts - 1) throw err;
      await sleep(600 * Math.pow(2, i));
    }
  }
  throw new Error('Max retries exceeded');
}

// Smaller batch size (5) with longer pauses to avoid rate limits
async function softDeleteBatch(ids: string[], updater: (id: string) => Promise<unknown>) {
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(id => withRetry(() => updater(id))));
    if (i + 5 < ids.length) await sleep(400);
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Soft-delete a board (tasks, rows, columns, cells, and the board record itself). UUID-safe: when boardId is a UUID, operates exclusively by that UUID with no name-based fallback.',
  inputSchema: z.object({
    boardId: z.string(),
    boardName: z.string(),
    projectCode: z.string(),
    boardType: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const now = new Date().toISOString();
    const u = context.user;
    const deletedBy = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

    // ════════════════════════════════════════════════════════════════════════
    // UUID PATH — operate exclusively by UUID, no name-based queries ever
    // ════════════════════════════════════════════════════════════════════════
    if (isUUID(input.boardId)) {
      const uuid = input.boardId;
      const boardIdVariants = [uuid, `${uuid}::groups`, `${uuid}::children`];

      // ── 1. Soft-delete the board record FIRST ───────────────────────────
      // El resto de esta función limpia filas/columnas/celdas en lotes de 5
      // con pausas entre cada uno — para un tablero grande puede tardar
      // varios segundos o más. Si el board se marca deletedAt hasta el
      // final, un reload de la página mientras el cleanup sigue en curso
      // lo trae de vuelta (el reload lee el board como "activo todavía",
      // porque técnicamente lo está). Marcarlo primero hace la eliminación
      // visible/definitiva de inmediato; el resto sigue en segundo plano
      // sin que nada dependa de leerlo como activo después de este punto.
      await withRetry(() => Boards.update({ id: uuid, record: { deletedAt: now } }));

      // ── 2. Fetch entities by UUID ──────────────────────────────────────
      const [rowsResult, tasksResult] = await Promise.all([
        RecruitmentRows.findAll({ filters: { boardId: uuid } as any, fields: ['id'], limit: 2000 }),
        Tasks.findAll({ filters: { boardId: uuid } as any, fields: ['id'], limit: 2000 }),
      ]);

      const [colResults, cellResults] = await Promise.all([
        Promise.all(boardIdVariants.map(bid =>
          BoardColumns.findAll({ filters: { boardId: bid }, fields: ['id'], limit: 2000 })
        )),
        Promise.all(boardIdVariants.map(bid =>
          CellValues.findAll({ filters: { boardId: bid }, fields: ['id'], limit: 2000 })
        )),
      ]);

      const allColIds = colResults.flatMap(r => r.records.map(c => c.id));
      const allCellIds = cellResults.flatMap(r => r.records.map(c => c.id));

      // ── 3. Soft-delete recruitment rows ────────────────────────────────
      await softDeleteBatch(rowsResult.records.map(r => r.id), id =>
        RecruitmentRows.update({ id, record: { deletedAt: now } })
      );
      await sleep(300);

      // ── 4. Soft-delete tasks ─────────────────────────────────────────────
      await softDeleteBatch(tasksResult.records.map(r => r.id), id =>
        Tasks.update({ id, record: { deletedAt: now, deletedBy } })
      );
      await sleep(300);

      // ── 5. Hard-delete CalendarEvents by boardId UUID ──────────────────
      if (input.boardType === 'calendar' || input.boardId.startsWith('cal-')) {
        const { records: calEvents } = await CalendarEvents.findAll({
          filters: { boardId: uuid } as any,
          fields: ['id'],
          limit: 2000,
        });
        if (calEvents.length > 0) {
          await softDeleteBatch(calEvents.map(e => e.id), id =>
            CalendarEvents.delete({ id })
          );
          await sleep(300);
        }
      }

      // ── 6. Soft-delete columns ─────────────────────────────────────────
      if (allColIds.length > 0) {
        await softDeleteBatch(allColIds, id =>
          BoardColumns.update({ id, record: { deletedAt: now, deletedBy } })
        );
        await sleep(500);
      }

      // ── 7. Soft-delete cells ────────────────────────────────────────────
      if (allCellIds.length > 0) {
        await softDeleteBatch(allCellIds, id =>
          CellValues.update({ id, record: { deletedAt: now } })
        );
      }

      return { success: true };
    }

    // ════════════════════════════════════════════════════════════════════════
    // LEGACY PATH — input.boardId is a composite like "pm-PROJECT-BOARD"
    // ════════════════════════════════════════════════════════════════════════

    // ── 1. Resolve board to get both UUID and legacy IDs ────────────────
    let resolved: { baseBoardId: string; legacyBaseId: string; boardId?: string; legacyCompositeId?: string };
    try {
      resolved = await resolveBoardId({
        boardIdOrKey: input.boardId,
        projectCode: input.projectCode,
        boardName: input.boardName,
        fallbackToLegacy: true,
      });
    } catch {
      resolved = { baseBoardId: input.boardId, legacyBaseId: input.boardId };
    }

    // ── 2. Build deduplicated set of all boardId variants to clean ───────
    const boardIdSet = new Set<string>([
      input.boardId,
      resolved.baseBoardId,
      resolved.legacyBaseId,
      `${resolved.baseBoardId}::groups`,
      `${resolved.baseBoardId}::children`,
      `${resolved.legacyBaseId}::groups`,
      `${resolved.legacyBaseId}::children`,
    ]);
    if (resolved.boardId) boardIdSet.add(resolved.boardId);
    if (resolved.legacyCompositeId) boardIdSet.add(resolved.legacyCompositeId);

    const boardIdsToClean = [...boardIdSet];

    // ── 3. Fetch all IDs to soft-delete ─────────────────────────────────
    const boardsFilter: Record<string, string> = {
      boardName: input.boardName,
      projectCode: input.projectCode,
    };
    if (input.boardType) boardsFilter.boardType = input.boardType;

    const [rowsResult, tasksResult, boardsResult] = await Promise.all([
      RecruitmentRows.findAll({
        filters: { boardName: input.boardName, projectCode: input.projectCode },
        fields: ['id'],
        limit: 2000,
      }),
      Tasks.findAll({
        filters: { boardName: input.boardName, projectCode: input.projectCode },
        fields: ['id'],
        limit: 2000,
      }),
      Boards.findAll({
        filters: boardsFilter as any,
        fields: ['id'],
        limit: 10,
      }),
    ]);

    const [colResults, cellResults] = await Promise.all([
      Promise.all(
        boardIdsToClean.map(bid =>
          BoardColumns.findAll({ filters: { boardId: bid }, fields: ['id'], limit: 2000 })
        )
      ),
      Promise.all(
        boardIdsToClean.map(bid =>
          CellValues.findAll({ filters: { boardId: bid }, fields: ['id'], limit: 2000 })
        )
      ),
    ]);

    const allColIds = colResults.flatMap(r => r.records.map(c => c.id));
    const allCellIds = cellResults.flatMap(r => r.records.map(c => c.id));

    // ── 4. Soft-delete the board record FIRST (usa lo ya leído arriba, no
    // vuelve a consultar) — el resto de esta función limpia filas/columnas/
    // celdas en lotes de 5 con pausas entre cada uno, que para un tablero
    // grande puede tardar. Si el board se marca deletedAt hasta el final,
    // un reload de la página mientras el cleanup sigue en curso lo trae de
    // vuelta porque técnicamente todavía está activo. Solo se borra el
    // primer match — previene borrar en masa tableros con el mismo nombre.
    const activeBoardRecords = boardsResult.records.filter(b => !b.deletedAt);
    if (activeBoardRecords.length > 0) {
      await withRetry(() => Boards.update({ id: activeBoardRecords[0].id, record: { deletedAt: now } }));
    }

    // ── 5. Soft-delete recruitment rows ─────────────────────────────────
    await softDeleteBatch(rowsResult.records.map(r => r.id), id =>
      RecruitmentRows.update({ id, record: { deletedAt: now } })
    );
    await sleep(300);

    // ── 6. Soft-delete tasks ─────────────────────────────────────────────
    await softDeleteBatch(tasksResult.records.map(r => r.id), id =>
      Tasks.update({ id, record: { deletedAt: now, deletedBy } })
    );
    await sleep(300);

    // ── 7. If calendar board, hard-delete CalendarEvents (UUID-safe) ───
    if (input.boardType === 'calendar' || input.boardId.startsWith('cal-')) {
      // Find exactly which Board UUID matches this legacy deletion
      if (activeBoardRecords.length === 1) {
        // Unambiguous — safe to delete CalendarEvents by that board's UUID
        const matchedBoardUUID = activeBoardRecords[0].id;
        const { records: calEvents } = await CalendarEvents.findAll({
          filters: { boardId: matchedBoardUUID } as any,
          fields: ['id'],
          limit: 2000,
        });
        if (calEvents.length > 0) {
          await softDeleteBatch(calEvents.map(e => e.id), id =>
            CalendarEvents.delete({ id })
          );
          await sleep(300);
        }
      } else if (activeBoardRecords.length > 1) {
        console.warn(`[deleteBoard] Ambiguous: ${activeBoardRecords.length} active boards match name "${input.boardName}", skipping CalendarEvents deletion`);
      }
      // 0 matches → skip, nothing to delete
    }

    // ── 8. Soft-delete columns ──────────────────────────────────────────
    if (allColIds.length > 0) {
      await softDeleteBatch(allColIds, id =>
        BoardColumns.update({ id, record: { deletedAt: now, deletedBy } })
      );
      await sleep(500);
    }

    // ── 9. Soft-delete cells ────────────────────────────────────────────
    if (allCellIds.length > 0) {
      await softDeleteBatch(allCellIds, id =>
        CellValues.update({ id, record: { deletedAt: now } })
      );
    }

    return { success: true };
  },
});
