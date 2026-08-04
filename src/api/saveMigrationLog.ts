import { z } from 'zod';
import { createEndpoint, MigrationLog } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Save a migration log entry',
  inputSchema: z.object({
    projectCode: z.string(),
    boardId: z.string().optional(),
    migrated: z.number(),
    failed: z.number(),
    skipped: z.number(),
    status: z.enum(['completed', 'partial', 'error']),
    durationSeconds: z.number(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const statusMap: Record<string, string> = { completed: 'Completed', partial: 'Partial', error: 'Error' };
    const rec = await MigrationLog.create({
      record: {
        projectCode: input.projectCode,
        boardId: input.boardId,
        migrated: input.migrated,
        failed: input.failed,
        skipped: input.skipped,
        status: statusMap[input.status],
        durationSeconds: input.durationSeconds,
        runBy: context.user.id,
      },
    });
    return { id: rec.id };
  },
});
