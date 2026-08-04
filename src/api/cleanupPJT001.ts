import { z } from 'zod';
import { createEndpoint, CellValues, ZiteError } from 'zite-integrations-backend-sdk';

const APPROVED_BOARD_IDS = [
  'recruitment-PJT-001-prueba 5',
  'recruitment-PJT-001-prueba 2',
  'recruitment-PJT-001-29 mar 344',
  'recruitment-PJT-001-pellet',
  'recruitment-PJT-001-prueba 3',
  'recruitment-PJT-001-PAIN',
  'recruitment-PJT-001-veamos',
  'recruitment-PJT-001-bravo',
  'recruitment-PJT-001-TIZANA',
  'recruitment-PJT-001-AWAY',
  'recruitment-PJT-001-centauro',
  'recruitment-PJT-001-IMÁN',
  'recruitment-PJT-001-inspire 6',
  'recruitment-PJT-001-otro prueba',
  'recruitment-PJT-001-INSPIRE 5',
  'recruitment-PJT-001-27 mar 26',
  'recruitment-PJT-001-MONEY MONEY',
  'recruitment-PJT-001-carrera',
  'recruitment-PJT-001-INSPIRE',
  'recruitment-PJT-001-PAIN::groups',
  'recruitment-PJT-001-IMÁN::groups',
  'recruitment-PJT-001-TIZANA::groups',
  'recruitment-PJT-001-veamos::groups',
] as const;

const EXPECTED_TOTAL = 340917;
const PREFIX = 'recruitment-PJT-001-';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i === retries - 1) throw e;
      await delay(delays[i] || 4000);
    }
  }
  throw new Error('unreachable');
}

async function collectActiveIds(boardId: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const page = await withRetry(() =>
      CellValues.findAll({
        filters: { boardId },
        limit: 2000,
        offset,
        fields: ['id', 'deletedAt'],
      })
    );
    for (const r of page.records) {
      if (!r.deletedAt) ids.push(r.id);
    }
    if (!page.hasMore) break;
    offset += page.records.length;
  }
  return ids;
}

type BoardResult = {
  boardId: string;
  found: number;
  softDeleted: number;
  failed: number;
  sampleIds: string[];
  error?: string;
};

export default createEndpoint({
  authenticated: true,
  description: 'Soft-delete all CellValues under recruitment-PJT-001-* legacy boardIds',
  inputSchema: z.object({
    mode: z.enum(['dry-run', 'apply']).default('dry-run'),
    confirm: z.string().optional(),
    boardIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    mode: z.string(),
    timestamp: z.string(),
    expectedTotal: z.number(),
    results: z.array(z.object({
      boardId: z.string(),
      found: z.number(),
      softDeleted: z.number(),
      failed: z.number(),
      sampleIds: z.array(z.string()),
      error: z.string().optional(),
    })),
    totalFound: z.number(),
    totalSoftDeleted: z.number(),
    totalFailed: z.number(),
    verification: z.object({
      activeRemaining: z.number(),
      byBoardId: z.array(z.object({ boardId: z.string(), active: z.number() })),
      passed: z.boolean(),
    }),
    delta: z.string(),
  }),
  execute: async ({ input }) => {
    if (input.mode === 'apply' && input.confirm !== 'PJT-001-CLEANUP') {
      throw new ZiteError({
        code: 'BAD_REQUEST',
        message: 'Para apply, debes enviar confirm: "PJT-001-CLEANUP"',
      });
    }

    const timestamp = new Date().toISOString();
    const results: BoardResult[] = [];
    let totalFound = 0;
    let totalSoftDeleted = 0;
    let totalFailed = 0;

    // Determine which boardIds to process
    let targetBoardIds: readonly string[] = APPROVED_BOARD_IDS;
    if (input.boardIds && input.boardIds.length > 0) {
      // Validate all provided boardIds are in the approved list
      const invalid = input.boardIds.filter(
        bid => !APPROVED_BOARD_IDS.includes(bid as any) || !bid.startsWith(PREFIX)
      );
      if (invalid.length > 0) {
        throw new ZiteError({
          code: 'BAD_REQUEST',
          message: `boardIds no aprobados: ${invalid.join(', ')}`,
        });
      }
      targetBoardIds = input.boardIds;
    }

    for (const boardId of targetBoardIds) {
      // Defense in depth
      if (!boardId.startsWith(PREFIX)) {
        results.push({ boardId, found: 0, softDeleted: 0, failed: 0, sampleIds: [], error: 'SKIPPED: invalid prefix' });
        continue;
      }

      let activeIds: string[] = [];
      let error: string | undefined;

      try {
        activeIds = await collectActiveIds(boardId);
      } catch (e: any) {
        error = `COLLECT_ERROR: ${e.message || String(e)}`;
        results.push({ boardId, found: 0, softDeleted: 0, failed: 0, sampleIds: [], error });
        continue;
      }

      const found = activeIds.length;
      totalFound += found;

      if (input.mode === 'dry-run' || found === 0) {
        results.push({ boardId, found, softDeleted: 0, failed: 0, sampleIds: activeIds.slice(0, 10) });
        continue;
      }

      // Apply mode: soft-delete in batches of 25
      let deleted = 0;
      let failed = 0;

      for (let i = 0; i < activeIds.length; i += 25) {
        const batch = activeIds.slice(i, i + 25);
        const settled = await Promise.allSettled(
          batch.map(id =>
            withRetry(() => CellValues.update({ id, record: { deletedAt: timestamp } }))
          )
        );
        for (const s of settled) {
          if (s.status === 'fulfilled') deleted++;
          else failed++;
        }
        if (i + 25 < activeIds.length) await delay(150);
      }

      totalSoftDeleted += deleted;
      totalFailed += failed;
      results.push({
        boardId,
        found,
        softDeleted: deleted,
        failed,
        sampleIds: activeIds.slice(0, 10),
        error: failed > 0 ? `${failed} updates failed` : undefined,
      });
    }

    // Verification: check 0 active remaining per boardId
    const verByBoard: { boardId: string; active: number }[] = [];
    let activeRemaining = 0;

    for (let i = 0; i < targetBoardIds.length; i += 5) {
      const batch = targetBoardIds.slice(i, i + 5);
      const checks = await Promise.all(
        batch.map(async (boardId) => {
          try {
            const page = await withRetry(() =>
              CellValues.findAll({
                filters: { boardId },
                limit: 1,
                fields: ['id', 'deletedAt'],
              })
            );
            const active = page.records.filter(r => !r.deletedAt).length + (page.hasMore ? 999 : 0);
            return { boardId, active };
          } catch {
            return { boardId, active: -1 };
          }
        })
      );
      for (const c of checks) {
        verByBoard.push(c);
        if (c.active > 0) activeRemaining += c.active;
      }
    }

    const diff = totalFound - EXPECTED_TOTAL;
    const delta = diff === 0 ? '+0 (match)' : diff > 0 ? `+${diff} (más de lo esperado)` : `${diff} (menos de lo esperado)`;

    return {
      mode: input.mode,
      timestamp,
      expectedTotal: EXPECTED_TOTAL,
      results,
      totalFound,
      totalSoftDeleted,
      totalFailed,
      verification: {
        activeRemaining,
        byBoardId: verByBoard,
        passed: input.mode === 'dry-run' ? true : activeRemaining === 0,
      },
      delta,
    };
  },
});
