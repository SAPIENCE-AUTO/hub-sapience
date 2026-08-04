import { z } from 'zod';
import { createEndpoint, ZiteError, Boards, Tasks, RecruitmentRows, BoardColumns, CellValues } from 'zite-integrations-backend-sdk';

async function fetchAllRecords<T extends { id: string }>(
  fetcher: (params: { offset: number; limit: number }) => Promise<{ records: T[]; hasMore: boolean }>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const limit = 2000;
  let hasMore = true;
  while (hasMore) {
    const result = await fetcher({ offset, limit });
    all.push(...result.records);
    hasMore = result.hasMore;
    offset += result.records.length;
  }
  return all;
}

async function updateInChunks<T extends { id: string }>(
  records: T[],
  updater: (record: T) => Promise<unknown>,
  chunkSize = 50,
) {
  for (let i = 0; i < records.length; i += chunkSize) {
    await Promise.all(records.slice(i, i + chunkSize).map(updater));
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Rename a board and cascade the rename to all related Tasks, BoardColumns, and CellValues',
  inputSchema: z.object({
    boardId: z.string().optional(),
    oldBoardName: z.string(),
    newBoardName: z.string(),
    projectCode: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ input }) => {
    const { oldBoardName, newBoardName, projectCode } = input;

    // ── 1. Find the Board record (prefer UUID, fall back to name search) ─────
    let existing: Awaited<ReturnType<typeof Boards.findOne>> | undefined;

    if (input.boardId) {
      existing = await Boards.findOne({ id: input.boardId });
      if (existing?.deletedAt) existing = undefined;
    }

    if (!existing) {
      const { records } = await Boards.findAll({
        filters: { boardName: oldBoardName, projectCode } as any,
        limit: 1,
      });
      existing = records.find(r => !r.deletedAt);
    }

    if (!existing) {
      throw new ZiteError({ code: 'NOT_FOUND', message: `Board not found: "${oldBoardName}" in project ${projectCode}` });
    }

    await Boards.update({ id: existing.id, record: { boardName: newBoardName } as any });

    // ── 2. Rename Tasks (paginated) ───────────────────────────────────────────
    const allTasks = await fetchAllRecords(({ offset, limit }) =>
      Tasks.findAll({ filters: { projectCode, boardName: oldBoardName }, offset, limit }),
    );
    await updateInChunks(allTasks, r =>
      Tasks.update({ id: r.id, record: { boardName: newBoardName } }),
    );

    // ── 2b. Rename RecruitmentRows (paginated) ──────────────────────────────────
    const allRecruitmentRows = await fetchAllRecords(({ offset, limit }) =>
      RecruitmentRows.findAll({ filters: { projectCode, boardName: oldBoardName } as any, offset, limit }),
    );
    const activeRecruitmentRows = allRecruitmentRows.filter(r => !r.deletedAt);
    if (activeRecruitmentRows.length > 0) {
      await updateInChunks(activeRecruitmentRows, r =>
        RecruitmentRows.update({ id: r.id, record: { boardName: newBoardName } as any }),
        20,
      );
    }

    // ── 3. Check if active data lives under legacy composites ─────────────────
    // Decision rule: if active (non-soft-deleted) columns or cells exist under
    // the legacy composite ID, this is still a legacy board → migrate them to
    // the new composite. If no active data exists under legacy, the board lives
    // under its stable UUID → skip column/cell migration entirely.
    // Detect board type to use the correct legacy prefix
    const boardType = existing.boardType as string | undefined;
    const legacyPrefix = boardType === 'recruitment' ? 'recruitment' : 'pm';
    const oldBoardId = `${legacyPrefix}-${projectCode}-${oldBoardName}`;
    const oldGroupBoardId = `${oldBoardId}::groups`;
    const oldChildrenBoardId = `${oldBoardId}::children`;

    const [allCols, allGroupCols, allChildrenCols, allCells, allGroupCells, allChildrenCells] = await Promise.all([
      fetchAllRecords(({ offset, limit }) =>
        BoardColumns.findAll({ filters: { boardId: oldBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
      fetchAllRecords(({ offset, limit }) =>
        BoardColumns.findAll({ filters: { boardId: oldGroupBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
      fetchAllRecords(({ offset, limit }) =>
        BoardColumns.findAll({ filters: { boardId: oldChildrenBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
      fetchAllRecords(({ offset, limit }) =>
        CellValues.findAll({ filters: { boardId: oldBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
      fetchAllRecords(({ offset, limit }) =>
        CellValues.findAll({ filters: { boardId: oldGroupBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
      fetchAllRecords(({ offset, limit }) =>
        CellValues.findAll({ filters: { boardId: oldChildrenBoardId }, fields: ['id', 'deletedAt'], offset, limit }),
      ),
    ]);

    // Filter to only active (non-soft-deleted) records — soft-deleted records
    // are dead data and must not be counted or migrated.
    const activeCols         = allCols.filter(r => !r.deletedAt);
    const activeGroupCols    = allGroupCols.filter(r => !r.deletedAt);
    const activeChildrenCols = allChildrenCols.filter(r => !r.deletedAt);
    const activeCells         = allCells.filter(r => !r.deletedAt);
    const activeGroupCells    = allGroupCells.filter(r => !r.deletedAt);
    const activeChildrenCells = allChildrenCells.filter(r => !r.deletedAt);

    const hasLegacyData =
      activeCols.length > 0 ||
      activeGroupCols.length > 0 ||
      activeChildrenCols.length > 0 ||
      activeCells.length > 0 ||
      activeGroupCells.length > 0 ||
      activeChildrenCells.length > 0;

    // ── 4. Only migrate if active data lives under legacy ─────────────────────
    // UUID boards store columns/cells under the stable UUID — renaming the
    // board name doesn't affect them, so we skip migration entirely.
    if (hasLegacyData) {
      const newBoardId          = `${legacyPrefix}-${projectCode}-${newBoardName}`;
      const newGroupBoardId     = `${newBoardId}::groups`;
      const newChildrenBoardId  = `${newBoardId}::children`;

      // Migrate only active columns (main + groups + children)
      await updateInChunks(activeCols, r =>
        BoardColumns.update({ id: r.id, record: { boardId: newBoardId } }),
      );
      await updateInChunks(activeGroupCols, r =>
        BoardColumns.update({ id: r.id, record: { boardId: newGroupBoardId } }),
      );
      await updateInChunks(activeChildrenCols, r =>
        BoardColumns.update({ id: r.id, record: { boardId: newChildrenBoardId } }),
      );

      // Migrate only active cells (main + groups + children)
      await updateInChunks(activeCells, r =>
        CellValues.update({ id: r.id, record: { boardId: newBoardId } }),
      );
      await updateInChunks(activeGroupCells, r =>
        CellValues.update({ id: r.id, record: { boardId: newGroupBoardId } }),
      );
      await updateInChunks(activeChildrenCells, r =>
        CellValues.update({ id: r.id, record: { boardId: newChildrenBoardId } }),
      );
    }

    return { success: true };
  },
});
