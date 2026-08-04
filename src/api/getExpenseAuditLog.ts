import { z } from 'zod';
import { createEndpoint, ExpenseAuditLog } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get audit log entries for a specific expense',
  inputSchema: z.object({ expenseId: z.string() }),
  outputSchema: z.object({
    entries: z.array(z.object({
      id: z.string(),
      timestamp: z.string().optional().nullable(),
      action: z.string().optional().nullable(),
      userEmail: z.string().optional().nullable(),
      userName: z.string().optional().nullable(),
      comments: z.string().optional().nullable(),
      expenseNumber: z.string().optional().nullable(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await ExpenseAuditLog.findAll({
      filters: { expense: input.expenseId } as never,
      limit: 200,
    });

    records.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

    return {
      entries: records.map(e => ({
        id: e.id,
        timestamp: e.timestamp ?? null,
        action: e.action ?? null,
        userEmail: e.userEmail ?? null,
        userName: e.userName ?? null,
        comments: e.comments ?? null,
        expenseNumber: e.expenseNumber ?? null,
      })),
    };
  },
});
