import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from 'zite-integrations-backend-sdk';

// Endpoint to hard-delete one batch of soft-deleted rows.
// Call repeatedly from the frontend until done === true.
export default createEndpoint({
  authenticated: true,
  description: 'Hard-delete a batch of soft-deleted Recruitment Rows. Returns remaining count.',
  inputSchema: z.object({
    projectCode: z.string(),
    batchSize: z.number().optional(), // default 50
  }),
  outputSchema: z.object({
    deleted: z.number(),
    done: z.boolean(),
  }),
  execute: async ({ input }) => {
    const batchSize = input.batchSize ?? 50;

    // Fetch a batch of rows for this project (all, not just deleted, because we can't filter deletedAt)
    const { records } = await RecruitmentRows.findAll({
      filters: { projectCode: input.projectCode },
      limit: 500,
      offset: 0,
      fields: ['id', 'deletedAt'],
    });

    const toDelete = records.filter(r => r.deletedAt).slice(0, batchSize);

    // Delete one at a time to stay within rate limits
    for (const r of toDelete) {
      await RecruitmentRows.delete({ id: r.id });
    }

    // Check if there are still soft-deleted rows remaining
    const { records: check } = await RecruitmentRows.findAll({
      filters: { projectCode: input.projectCode },
      limit: 100,
      offset: 0,
      fields: ['id', 'deletedAt'],
    });
    const remaining = check.filter(r => r.deletedAt).length;

    return { deleted: toDelete.length, done: remaining === 0 };
  },
});
