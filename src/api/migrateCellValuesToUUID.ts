import { z } from 'zod';
import { createEndpoint, Boards, CellValues } from 'zite-integrations-backend-sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_BUDGET_MS = 90_000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500;
const RETRY_DELAY_MS = 2000;

function buildLegacyVariants(boardType: string, projectCode: string, boardName: string): string[] {
  const prefix = boardType === 'calendar' ? 'cal-'
    : boardType === 'recruitment' ? 'recruitment-'
    : boardType === 'events' ? 'events-'
    : 'pm-';
  const base = boardName ? `${prefix}${projectCode}-${boardName}` : `${prefix}${projectCode}`;
  return [base, `${base}::groups`, `${base}::children`];
}

function isLegacyBoardId(id: string): boolean {
  const base = id.replace(/::groups$|::children$/, '');
  return !UUID_RE.test(base);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export default createEndpoint({
  authenticated: true,
  description: 'Migrate CellValues boardId from legacy to UUID for a project — resumable, chunked, idempotent',
  inputSchema: z.object({
    projectCode: z.string(),
    boardId: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
    dryRun: z.boolean(),
  }),
  outputSchema: z.object({
    projectCode: z.string(),
    boardId: z.string().nullable(),
    targetUUID: z.string().nullable(),
    migrated: z.number(),
    skipped: z.number(),
    failed: z.number(),
    offset: z.number(),
    nextOffset: z.number().nullable(),
    remaining: z.number().nullable(),
    done: z.boolean(),
    allDone: z.boolean(),
    dryRun: z.boolean(),
    elapsed: z.number(),
    timedOut: z.boolean(),
  }),
  execute: async ({ input }) => {
    const startTime = Date.now();
    const { projectCode, dryRun } = input;
    const limit = input.limit ?? 2000;
    const inputOffset = input.offset ?? 0;

    // 1. Load boards and build legacy→UUID map
    const { records: boards } = await Boards.findAll({ filters: { projectCode }, limit: 200 });
    const activeBoards = boards.filter(b => !b.deletedAt);

    const legacyToUUID: Record<string, string> = {};
    for (const board of activeBoards) {
      const bType = board.boardType || 'pm';
      const bName = board.boardName ?? '';
      const variants = buildLegacyVariants(bType, projectCode, bName);
      legacyToUUID[variants[0]] = board.id;
      legacyToUUID[variants[1]] = `${board.id}::groups`;
      legacyToUUID[variants[2]] = `${board.id}::children`;
    }

    // 2. Determine which boardId to process
    let targetBoardId = input.boardId ?? null;

    if (!targetBoardId) {
      for (const legacyId of Object.keys(legacyToUUID)) {
        const { records } = await CellValues.findAll({
          filters: { boardId: legacyId },
          limit: 1,
          fields: ['id'],
        });
        if (records.length > 0) {
          targetBoardId = legacyId;
          break;
        }
      }
    }

    // No legacy boardId found → all done
    if (!targetBoardId) {
      return {
        projectCode,
        boardId: null,
        targetUUID: null,
        migrated: 0,
        skipped: 0,
        failed: 0,
        offset: 0,
        nextOffset: null,
        remaining: null,
        done: true,
        allDone: true,
        dryRun,
        elapsed: (Date.now() - startTime) / 1000,
        timedOut: false,
      };
    }

    const targetUUID = legacyToUUID[targetBoardId] ?? null;

    // 3. Fetch CellValues
    // Live mode: offset=0 because migrated records leave the filter
    // Dry run: use input offset to paginate without re-counting
    const fetchOffset = dryRun ? inputOffset : 0;
    const { records: cells, hasMore } = await CellValues.findAll({
      filters: { boardId: targetBoardId },
      offset: fetchOffset,
      limit,
      fields: ['id', 'boardId'],
    });

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let timedOut = false;
    let cellsProcessed = 0;
    let stoppedEarly = false;

    // 4. Process in batches of BATCH_SIZE with Promise.allSettled
    for (let i = 0; i < cells.length; i += BATCH_SIZE) {
      // Time budget check
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }

      const batch = cells.slice(i, i + BATCH_SIZE);
      const toUpdate: { id: string; newBoardId: string }[] = [];

      for (const cell of batch) {
        const bid = cell.boardId ?? '';
        if (!isLegacyBoardId(bid)) {
          skipped++;
          continue;
        }
        if (targetUUID) {
          toUpdate.push({ id: cell.id, newBoardId: targetUUID });
        } else {
          failed++;
        }
      }

      cellsProcessed += batch.length;

      if (toUpdate.length === 0) continue;

      if (!dryRun) {
        // Execute updates in parallel with allSettled
        const results = await Promise.allSettled(
          toUpdate.map(u =>
            CellValues.update({ id: u.id, record: { boardId: u.newBoardId } })
          )
        );

        let fulfilled = results.filter(r => r.status === 'fulfilled').length;
        const failedItems = toUpdate.filter((_, idx) => results[idx].status === 'rejected');

        // Retry failed items once after waiting
        if (failedItems.length > 0) {
          await delay(RETRY_DELAY_MS);

          const retryResults = await Promise.allSettled(
            failedItems.map(u =>
              CellValues.update({ id: u.id, record: { boardId: u.newBoardId } })
            )
          );

          const retryFulfilled = retryResults.filter(r => r.status === 'fulfilled').length;
          const retryFailed = retryResults.filter(r => r.status === 'rejected').length;

          fulfilled += retryFulfilled;

          if (retryFailed > 0) {
            // Same records failed twice — stop and report
            migrated += fulfilled;
            failed += retryFailed;
            stoppedEarly = true;
            break;
          }
        }

        // Verify one cell from the batch actually changed
        const verifyCell = await CellValues.findOne({
          id: toUpdate[0].id,
          fields: ['boardId'],
        });

        if (!verifyCell || isLegacyBoardId(verifyCell.boardId ?? '')) {
          // Verification failed — updates didn't stick
          failed += fulfilled;
          stoppedEarly = true;
          break;
        }

        // All good — count as migrated
        migrated += fulfilled;
      } else {
        // Dry run — just count
        migrated += toUpdate.length;
      }

      // Delay between batches (skip on last batch)
      if (i + BATCH_SIZE < cells.length) {
        await delay(BATCH_DELAY_MS);
      }
    }

    // 5. Determine done / nextOffset
    const processedAll = cellsProcessed >= cells.length;
    const done = !hasMore && processedAll && !timedOut && !stoppedEarly;

    let nextOffset: number | null = null;
    if (!done) {
      if (dryRun) {
        // In dry run, advance by what we processed
        nextOffset = fetchOffset + cellsProcessed;
      } else {
        // In live mode, offset stays 0 (records leave filter)
        nextOffset = 0;
      }
    }

    let remaining: number | null = null;
    if (!done) {
      const unprocessed = cells.length - cellsProcessed;
      remaining = unprocessed + (hasMore ? 1 : 0); // +1 signals "more pages exist"
      if (remaining < 0) remaining = null;
    }

    // 6. Check allDone — are there other legacy boardIds with cells?
    let allDone = done;
    if (done) {
      for (const legacyId of Object.keys(legacyToUUID)) {
        if (legacyId === targetBoardId) continue;
        const { records } = await CellValues.findAll({
          filters: { boardId: legacyId },
          limit: 1,
          fields: ['id'],
        });
        if (records.length > 0) {
          allDone = false;
          break;
        }
      }
    }

    return {
      projectCode,
      boardId: targetBoardId,
      targetUUID,
      migrated,
      skipped,
      failed,
      offset: fetchOffset,
      nextOffset,
      remaining,
      done,
      allDone,
      dryRun,
      elapsed: (Date.now() - startTime) / 1000,
      timedOut,
    };
  },
});
