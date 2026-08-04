import { z } from 'zod';
import { createEndpoint, ExpenseComments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get comments for a specific expense in chronological order',
  inputSchema: z.object({ expenseId: z.string() }),
  outputSchema: z.object({
    comments: z.array(z.object({
      id: z.string(),
      comment: z.string().optional().nullable(),
      authorEmail: z.string().optional().nullable(),
      authorName: z.string().optional().nullable(),
      createdAt: z.string().optional().nullable(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await ExpenseComments.findAll({
      filters: { expense: input.expenseId } as never,
      limit: 500,
    });

    records.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

    return {
      comments: records.map(c => ({
        id: c.id,
        comment: c.comment ?? null,
        authorEmail: c.authorEmail ?? null,
        authorName: c.authorName ?? null,
        createdAt: c.createdAt ?? null,
      })),
    };
  },
});
