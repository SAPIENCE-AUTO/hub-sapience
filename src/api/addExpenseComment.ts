import { z } from 'zod';
import { createEndpoint, ExpenseComments } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Add a comment to an expense',
  inputSchema: z.object({ expenseId: z.string(), comment: z.string() }),
  outputSchema: z.object({ id: z.string(), success: z.boolean() }),
  execute: async ({ input, context }) => {
    const authorName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;

    const created = await ExpenseComments.create({
      record: {
        comment: input.comment,
        expense: input.expenseId,
        authorEmail: context.user!.email,
        authorName,
      },
    });

    return { id: created.id, success: true };
  },
});
