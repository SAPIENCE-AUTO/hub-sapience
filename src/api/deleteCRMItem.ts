import { z } from 'zod';
import { createEndpoint, CrmItems } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a CRM item',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await CrmItems.delete({ id: input.id });
    return { success: true };
  },
});
