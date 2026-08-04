import { z } from 'zod';
import { createEndpoint, CellValues } from 'zite-integrations-backend-sdk';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Repairs CellValues whose boardId embeds an old project code.
 * Runs in pages of 200, up to maxPages iterations per prefix, so it won't timeout.
 * Call repeatedly until done = true.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Repair orphaned CellValues boardIds for a given old→new project code mapping. Returns { done, fixedThisRun, totalFixed } — call repeatedly until done=true.',
  inputSchema: z.object({
    oldCode: z.string(),
    newCode: z.string(),
    maxPages: z.number().optional(), // pages of 200 per call, default 10
  }),
  outputSchema: z.object({
    done: z.boolean(),
    fixedThisRun: z.number(),
    remainingEstimate: z.number(),
  }),
  execute: async ({ input }) => {
    const { oldCode, newCode, maxPages = 10 } = input;
    const escaped = oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixes = [`pm-${oldCode}-`, `cal-${oldCode}-`, `recruitment-${oldCode}-`];
    const pageSize = 200;
    let fixedThisRun = 0;
    let remainingEstimate = 0;
    let allDone = true;

    for (const prefix of prefixes) {
      let pages = 0;
      while (pages < maxPages) {
        const { records, hasMore } = await CellValues.findAll({
          filters: { boardId: { contains: prefix } } as any,
          limit: pageSize, offset: 0, // Always offset 0 — we update them so next call gets fresh ones
          fields: ['id', 'boardId'],
        });

        if (records.length === 0) break;

        // Update in chunks of 15
        for (let i = 0; i < records.length; i += 15) {
          const chunk = records.slice(i, i + 15);
          await Promise.all(chunk.map(r => {
            const newBoardId = (r.boardId ?? '').replace(
              new RegExp(`(pm|cal|recruitment)-${escaped}-`),
              `$1-${newCode}-`
            );
            return CellValues.update({ id: r.id, record: { boardId: newBoardId } } as any);
          }));
          await sleep(150);
        }

        fixedThisRun += records.length;
        pages++;

        if (!hasMore) break;

        // If still more after maxPages, mark as not done
        if (pages >= maxPages && hasMore) {
          allDone = false;
          remainingEstimate += 999; // estimate
        }

        await sleep(200);
      }
    }

    return { done: allDone, fixedThisRun, remainingEstimate };
  },
});
