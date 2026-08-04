import { z } from 'zod';
import { createEndpoint, Projects } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Link or unlink a deal from a project for P&L cost analysis',
  inputSchema: z.object({
    projectId: z.string(),
    dealId: z.string().optional(), // omit to unlink
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Projects.update({
      id: input.projectId,
      record: { dealVinculado: input.dealId ? [input.dealId] : [] },
    });
    return { success: true };
  },
});
