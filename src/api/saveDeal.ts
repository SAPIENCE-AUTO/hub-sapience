import { z } from 'zod';
import { createEndpoint, Deals } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a deal',
  inputSchema: z.object({
    id: z.string().optional(),
    dealName: z.string().optional(),
    phase: z.string().optional(),
    client: z.string().optional(),
    projectType: z.string().optional(),
    tematica: z.string().optional(),
    owner: z.array(z.string()).optional(),
    proposalDate: z.string().optional(),
    approvalDate: z.string().optional(),
    currency: z.string().optional(),
    clientPrice: z.number().optional(),
    taxesPct: z.number().optional(),
    retencionesPct: z.number().optional(),
    quotedCost: z.number().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const { id, retencionesPct, ...rest } = input;
    const record = { ...rest, retenciones: retencionesPct };
    if (id) {
      await Deals.update({ id, record });
      return { id };
    }
    const created = await Deals.create({ record });
    return { id: created.id };
  },
});
