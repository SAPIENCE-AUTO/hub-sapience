import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns, SharedViews } from 'zite-integrations-backend-sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_PREFIXES = [
  { prefix: 'recruitment-', boardType: 'recruitment' },
  { prefix: 'cal-', boardType: 'calendar' },
  { prefix: 'events-', boardType: 'events' },
  { prefix: 'pm-', boardType: 'pm' },
] as const;

function buildLegacyVariants(boardType: string, projectCode: string, boardName: string): string[] {
  const prefix = boardType === 'calendar' ? 'cal-'
    : boardType === 'recruitment' ? 'recruitment-'
    : boardType === 'events' ? 'events-'
    : 'pm-';
  const base = boardName ? `${prefix}${projectCode}-${boardName}` : `${prefix}${projectCode}`;
  return [base, `${base}::groups`, `${base}::children`];
}

function detectLegacyProjectCode(boardId: string): string | null {
  for (const { prefix } of KNOWN_PREFIXES) {
    if (boardId.startsWith(prefix)) return boardId.slice(prefix.length).split('-').slice(0, 2).join('-');
  }
  return null;
}

function isLegacyBoardId(id: string): boolean {
  const base = id.replace(/::groups$|::children$/, '');
  return !UUID_RE.test(base);
}

export default createEndpoint({
  authenticated: true,
  description: 'Migrate BoardColumns and SharedViews from legacy composite boardId to UUID for a given project',
  inputSchema: z.object({
    projectCode: z.string(),
    dryRun: z.boolean(),
  }),
  outputSchema: z.object({
    boardMap: z.record(z.string(), z.string()),
    columns: z.object({
      total: z.number(),
      migrated: z.number(),
      alreadyUUID: z.number(),
      failed: z.number(),
      byBoard: z.record(z.string(), z.number()),
    }),
    views: z.object({
      total: z.number(),
      migrated: z.number(),
      alreadyUUID: z.number(),
    }),
    dryRun: z.boolean(),
  }),
  execute: async ({ input }) => {
    const { projectCode, dryRun } = input;

    // 1. Load all boards for this project
    const { records: boards } = await Boards.findAll({
      filters: { projectCode },
      limit: 200,
    });
    const activeBoards = boards.filter(b => !b.deletedAt);

    // 2. Build legacy → UUID map (including ::groups and ::children variants)
    const boardMap: Record<string, string> = {};
    for (const board of activeBoards) {
      const bType = board.boardType || 'pm';
      const bName = board.boardName ?? '';
      const variants = buildLegacyVariants(bType, projectCode, bName);
      // variants[0] = base, variants[1] = ::groups, variants[2] = ::children
      boardMap[variants[0]] = board.id;
      boardMap[variants[1]] = `${board.id}::groups`;
      boardMap[variants[2]] = `${board.id}::children`;
    }

    // 3. Scan all BoardColumns with pagination, filter legacy ones for this project
    const colResult = { total: 0, migrated: 0, alreadyUUID: 0, failed: 0, byBoard: {} as Record<string, number> };
    let colOffset = 0;
    let colHasMore = true;
    const colBatchUpdates: { id: string; newBoardId: string }[] = [];

    while (colHasMore) {
      const { records, hasMore } = await BoardColumns.findAll({ offset: colOffset, limit: 2000 });
      for (const col of records) {
        const bid = col.boardId ?? '';
        if (!bid) continue;

        // Check if this column belongs to this project
        const belongsToProject = boardMap[bid] !== undefined
          || (isLegacyBoardId(bid) && detectLegacyProjectCode(bid)?.startsWith(projectCode));

        if (!belongsToProject) {
          // Check if it's a UUID that maps to one of our boards
          const base = bid.replace(/::groups$|::children$/, '');
          if (UUID_RE.test(base) && activeBoards.some(b => b.id === base)) {
            colResult.total++;
            colResult.alreadyUUID++;
          }
          continue;
        }

        colResult.total++;

        if (!isLegacyBoardId(bid)) {
          colResult.alreadyUUID++;
          continue;
        }

        const mapped = boardMap[bid];
        if (mapped) {
          colBatchUpdates.push({ id: col.id, newBoardId: mapped });
          colResult.byBoard[bid] = (colResult.byBoard[bid] ?? 0) + 1;
        } else {
          colResult.failed++;
        }
      }
      colOffset += records.length;
      colHasMore = hasMore;
    }

    // 4. Apply column updates in batches of 100
    if (!dryRun) {
      for (let i = 0; i < colBatchUpdates.length; i += 100) {
        const batch = colBatchUpdates.slice(i, i + 100);
        await Promise.all(batch.map(u =>
          BoardColumns.update({ id: u.id, record: { boardId: u.newBoardId } })
        ));
      }
    }
    colResult.migrated = dryRun ? 0 : colBatchUpdates.length;
    // If dryRun, report how many WOULD be migrated via byBoard totals

    // 5. Scan SharedViews with pagination
    const viewResult = { total: 0, migrated: 0, alreadyUUID: 0 };
    let viewOffset = 0;
    let viewHasMore = true;
    const viewBatchUpdates: { id: string; newBoardId: string }[] = [];

    while (viewHasMore) {
      const { records, hasMore } = await SharedViews.findAll({
        filters: { projectCode },
        offset: viewOffset,
        limit: 2000,
      });
      for (const view of records) {
        const bid = view.boardId ?? '';
        if (!bid) continue;
        viewResult.total++;

        if (!isLegacyBoardId(bid)) {
          viewResult.alreadyUUID++;
          continue;
        }

        const mapped = boardMap[bid];
        if (mapped) {
          viewBatchUpdates.push({ id: view.id, newBoardId: mapped });
        }
      }
      viewOffset += records.length;
      viewHasMore = hasMore;
    }

    // 6. Apply view updates in batches of 100
    if (!dryRun) {
      for (let i = 0; i < viewBatchUpdates.length; i += 100) {
        const batch = viewBatchUpdates.slice(i, i + 100);
        await Promise.all(batch.map(u =>
          SharedViews.update({ id: u.id, record: { boardId: u.newBoardId } })
        ));
      }
    }
    viewResult.migrated = dryRun ? 0 : viewBatchUpdates.length;

    return {
      boardMap,
      columns: colResult,
      views: viewResult,
      dryRun,
    };
  },
});
