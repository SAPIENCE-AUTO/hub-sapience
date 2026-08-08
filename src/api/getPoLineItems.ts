import { z } from 'zod';
import { createEndpoint, PoLineItems } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get line items for a purchase order',
  inputSchema: z.object({ poId: z.string() }),
  outputSchema: z.object({
    lineItems: z.array(z.object({
      id: z.string(),
      description: z.string(),
      category: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      total: z.number(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await PoLineItems.findAll({ filters: { poId: input.poId }, limit: 200 });
    return {
      lineItems: records.map(r => ({
        id: r.id,
        description: r.description ?? '',
        category: r.category ?? '',
        quantity: r.quantity ?? 1,
        unitPrice: r.unitPrice ?? 0,
        total: r.total ?? 0,
      })),
    };
  },
});
