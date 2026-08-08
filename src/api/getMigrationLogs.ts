import { z } from 'zod';
import { createEndpoint, MigrationLog } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get migration log entries, newest first',
  inputSchema: z.object({
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({
    logs: z.array(z.object({
      id: z.string(),
      projectCode: z.string().optional(),
      boardId: z.string().optional(),
      migrated: z.number().optional(),
      failed: z.number().optional(),
      skipped: z.number().optional(),
      status: z.string().optional(),
      durationSeconds: z.number().optional(),
      createdAt: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const filters: Record<string, unknown> = {};
    if (input.projectCode) filters.projectCode = input.projectCode;

    const { records } = await MigrationLog.findAll({
      filters,
      limit: 100,
    });

    // Sort newest first by createdAt
    records.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    return {
      logs: records.map(r => ({
        id: r.id,
        projectCode: r.projectCode,
        boardId: r.boardId,
        migrated: r.migrated,
        failed: r.failed,
        skipped: r.skipped,
        status: r.status,
        durationSeconds: r.durationSeconds,
        createdAt: r.createdAt,
      })),
    };
  },
});
