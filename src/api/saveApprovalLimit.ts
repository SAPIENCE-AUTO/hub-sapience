import { z } from 'zod';
import { createEndpoint, ApprovalLimits } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Creates or updates an approval limit record',
  inputSchema: z.object({
    id: z.string().optional(),
    costCenter: z.string(),
    approvalLevel: z.string(),
    maxAmount: z.number(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    if (input.id) {
      const result = await ApprovalLimits.update({
        id: input.id,
        record: {
          costCenter: input.costCenter,
          approvalLevel: input.approvalLevel,
          maxAmount: input.maxAmount,
        },
      });
      return { success: true, id: result.id };
    } else {
      const result = await ApprovalLimits.create({
        record: {
          costCenter: input.costCenter,
          approvalLevel: input.approvalLevel,
          maxAmount: input.maxAmount,
        },
      });
      return { success: true, id: result.id };
    }
  },
});
