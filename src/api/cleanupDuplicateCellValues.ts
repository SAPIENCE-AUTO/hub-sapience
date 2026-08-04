import { z } from 'zod';
import { createEndpoint, Boards, CellValues } from 'zite-integrations-backend-sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUFFIXES = ['', '::groups', '::children'] as const;
const BATCH_DELAY_MS = 300;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function buildLegacyId(boardType: string, projectCode: string, boardName: string): string {
  const prefix = boardType === 'calendar' ? 'cal-'
    : boardType === 'recruitment' ? 'recruitment-'
    : boardType === 'events' ? 'events-'
    : 'pm-';
  return boardName ? `${prefix}${projectCode}-${boardName}` : `${prefix}${projectCode}`;
}

const exampleSchema = z.object({
  rowId: z.string(),
  columnId: z.string(),
  legacyBoardId: z.string(),
  uuidBoardId: z.string(),
  keptId: z.string(),
  deletedIds: z.array(z.string()),
  action: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Detect and clean up duplicate CellValues across legacy and UUID boardIds for a given project. Supports dryRun mode. Does not touch events- boards.',
  inputSchema: z.object({
    projectCode: z.string(),
    dryRun: z.boolean().default(true),
  }),
  outputSchema: z.object({
    projectCode: z.string(),
    dryRun: z.boolean(),
    boardPairsScanned: z.number(),
    totalCellsScanned: z.number(),
    duplicateGroupsFound: z.number(),
    recordsToKeep: z.number(),
    recordsToMigrate: z.number(),
    recordsToDelete: z.number(),
    migrated: z.number(),
    deleted: z.number(),
    failed: z.number(),
    examples: z.array(exampleSchema),
    elapsed: z.number(),
  }),
  execute: async ({ input }) => {
    const startTime = Date.now();
    const { projectCode, dryRun } = input;

    // 1. Load all active boards for this project
    const { records: boards } = await Boards.findAll({
      filters: { projectCode },
      limit: 200,
    });
    const activeBoards = boards.filter(b => !b.deletedAt);

    // 2. Build legacy→UUID pairs (skip events- boards)
    const boardPairs: Array<{
      uuid: string;
      legacy: string;
      suffix: string;
      boardName: string;
      boardType: string;
    }> = [];

    for (const board of activeBoards) {
      const bType = board.boardType || 'pm';
      if (bType === 'events') continue; // events- are permanent legacy
      const bName = board.boardName ?? '';
      const legacyBase = buildLegacyId(bType, projectCode, bName);

      for (const suffix of SUFFIXES) {
        boardPairs.push({
          uuid: suffix ? `${board.id}${suffix}` : board.id,
          legacy: suffix ? `${legacyBase}${suffix}` : legacyBase,
          suffix,
          boardName: bName,
          boardType: bType,
        });
      }
    }

    // 3. For each pair, load cells under both boardIds and detect duplicates
    let totalCellsScanned = 0;
    let duplicateGroupsFound = 0;
    let recordsToKeep = 0;
    let recordsToMigrate = 0;
    let recordsToDelete = 0;
    let migrated = 0;
    let deleted = 0;
    let failed = 0;
    const examples: z.infer<typeof exampleSchema>[] = [];

    for (const pair of boardPairs) {
      // Load all cells under UUID boardId
      const uuidCells: any[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await CellValues.findAll({
          filters: { boardId: pair.uuid },
          offset,
          limit: 2000,
        });
        uuidCells.push(...res.records);
        hasMore = res.hasMore;
        offset += res.records.length;
      }

      // Load all cells under legacy boardId (skip if same as UUID)
      const legacyCells: any[] = [];
      if (pair.legacy !== pair.uuid) {
        offset = 0;
        hasMore = true;
        while (hasMore) {
          const res = await CellValues.findAll({
            filters: { boardId: pair.legacy },
            offset,
            limit: 2000,
          });
          legacyCells.push(...res.records);
          hasMore = res.hasMore;
          offset += res.records.length;
        }
      }

      totalCellsScanned += uuidCells.length + legacyCells.length;

      if (uuidCells.length === 0 && legacyCells.length === 0) continue;

      // Group all cells by rowId + columnId
      const groups: Record<string, { uuid: any[]; legacy: any[] }> = {};

      for (const cell of uuidCells) {
        const key = `${cell.rowId}|${cell.columnId}`;
        if (!groups[key]) groups[key] = { uuid: [], legacy: [] };
        groups[key].uuid.push(cell);
      }
      for (const cell of legacyCells) {
        const key = `${cell.rowId}|${cell.columnId}`;
        if (!groups[key]) groups[key] = { uuid: [], legacy: [] };
        groups[key].legacy.push(cell);
      }

      // Process each group
      for (const [key, group] of Object.entries(groups)) {
        const totalInGroup = group.uuid.length + group.legacy.length;
        if (totalInGroup <= 1 && group.legacy.length === 0) continue; // No action needed

        // Case 1: Legacy-only (no UUID) → migrate to UUID
        if (group.uuid.length === 0 && group.legacy.length > 0) {
          // Keep the first legacy cell, migrate it; delete extras
          const keeper = group.legacy[0];
          const extras = group.legacy.slice(1);

          duplicateGroupsFound += extras.length > 0 ? 1 : 0;
          recordsToKeep++;
          recordsToMigrate++;
          recordsToDelete += extras.length;

          if (!dryRun) {
            try {
              await CellValues.update({ id: keeper.id, record: { boardId: pair.uuid } });
              migrated++;
            } catch {
              failed++;
            }
            for (const extra of extras) {
              try {
                await CellValues.delete({ id: extra.id });
                deleted++;
              } catch {
                failed++;
              }
            }
            await delay(BATCH_DELAY_MS);
          }

          if (examples.length < 50) {
            examples.push({
              rowId: keeper.rowId ?? '',
              columnId: keeper.columnId ?? '',
              legacyBoardId: pair.legacy,
              uuidBoardId: pair.uuid,
              keptId: keeper.id,
              deletedIds: extras.map((e: any) => e.id),
              action: extras.length > 0 ? 'migrate+dedup' : 'migrate',
            });
          }
          continue;
        }

        // Case 2: UUID exists — legacy are duplicates to delete
        if (group.uuid.length >= 1 && group.legacy.length > 0) {
          duplicateGroupsFound++;
          // Keep the first UUID cell
          const keeper = group.uuid[0];
          const uuidExtras = group.uuid.slice(1);
          const toDelete = [...group.legacy, ...uuidExtras];

          recordsToKeep++;
          recordsToDelete += toDelete.length;

          if (!dryRun) {
            for (const dup of toDelete) {
              try {
                await CellValues.delete({ id: dup.id });
                deleted++;
              } catch {
                failed++;
              }
            }
            if (toDelete.length > 0) await delay(BATCH_DELAY_MS);
          }

          if (examples.length < 50) {
            examples.push({
              rowId: keeper.rowId ?? '',
              columnId: keeper.columnId ?? '',
              legacyBoardId: pair.legacy,
              uuidBoardId: pair.uuid,
              keptId: keeper.id,
              deletedIds: toDelete.map((d: any) => d.id),
              action: 'dedup-cross-boardId',
            });
          }
          continue;
        }

        // Case 3: Multiple UUID cells, no legacy — exact duplicates under same boardId
        if (group.uuid.length > 1 && group.legacy.length === 0) {
          duplicateGroupsFound++;
          const keeper = group.uuid[0];
          const extras = group.uuid.slice(1);

          recordsToKeep++;
          recordsToDelete += extras.length;

          if (!dryRun) {
            for (const dup of extras) {
              try {
                await CellValues.delete({ id: dup.id });
                deleted++;
              } catch {
                failed++;
              }
            }
            if (extras.length > 0) await delay(BATCH_DELAY_MS);
          }

          if (examples.length < 50) {
            examples.push({
              rowId: keeper.rowId ?? '',
              columnId: keeper.columnId ?? '',
              legacyBoardId: pair.legacy,
              uuidBoardId: pair.uuid,
              keptId: keeper.id,
              deletedIds: extras.map((e: any) => e.id),
              action: 'dedup-same-boardId',
            });
          }
        }
      }
    }

    return {
      projectCode,
      dryRun,
      boardPairsScanned: boardPairs.length,
      totalCellsScanned,
      duplicateGroupsFound,
      recordsToKeep,
      recordsToMigrate,
      recordsToDelete,
      migrated,
      deleted,
      failed,
      examples,
      elapsed: (Date.now() - startTime) / 1000,
    };
  },
});
