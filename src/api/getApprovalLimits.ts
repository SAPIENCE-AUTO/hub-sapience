import { z } from 'zod';
import { createEndpoint, ApprovalLimits } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Returns all approval limit records',
  inputSchema: z.object({}),
  outputSchema: z.object({
    limits: z.array(z.object({
      id: z.string(),
      costCenter: z.string().optional(),
      approvalLevel: z.string().optional(),
      maxAmount: z.number().optional(),
    })),
  }),
  execute: async () => {
    const result = await ApprovalLimits.findAll({ limit: 500 });
    return {
      limits: result.records.map(r => ({
        id: r.id,
        costCenter: r.costCenter,
        approvalLevel: r.approvalLevel,
        maxAmount: r.maxAmount,
      })),
    };
  },
});
