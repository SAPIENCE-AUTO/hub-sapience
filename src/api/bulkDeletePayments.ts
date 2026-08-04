import { z } from 'zod';
import { createEndpoint, Payments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Bulk delete multiple payments',
  inputSchema: z.object({ ids: z.array(z.string()) }),
  outputSchema: z.object({ success: z.boolean(), deleted: z.number() }),
  execute: async ({ input }) => {
    for (const id of input.ids) {
      await Payments.delete({ id });
    }
    return { success: true, deleted: input.ids.length };
  },
});
