import { z } from 'zod';
import { createEndpoint, Payments } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Bulk update status for multiple payments',
  inputSchema: z.object({
    ids: z.array(z.string()),
    status: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean(), updated: z.number() }),
  execute: async ({ input }) => {
    for (const id of input.ids) {
      await Payments.update({ id, record: { status: input.status } });
    }
    return { success: true, updated: input.ids.length };
  },
});
