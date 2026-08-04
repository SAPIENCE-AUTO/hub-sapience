import { z } from 'zod';
import { createEndpoint, ExpenseLineItems } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get line items for a specific expense',
  inputSchema: z.object({ expenseId: z.string() }),
  outputSchema: z.object({
    lineItems: z.array(z.object({
      id: z.string(),
      description: z.string().nullable(),
      category: z.string().nullable(),
      amount: z.number().nullable(),
      date: z.string().nullable(),
      receipt: z.array(z.object({ url: z.string() })).nullable(),
      notes: z.string().nullable(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await ExpenseLineItems.findAll({
      filters: { expense: input.expenseId } as never,
      limit: 200,
    });
    return {
      lineItems: records.map(li => ({
        id: li.id,
        description: li.description ?? null,
        category: li.category ?? null,
        amount: li.amount ?? null,
        date: li.date ?? null,
        receipt: (li.receipt as { url: string }[] | undefined) ?? null,
        notes: li.notes ?? null,
      })),
    };
  },
});
