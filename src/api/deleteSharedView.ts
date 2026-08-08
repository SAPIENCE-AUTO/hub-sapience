import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Deletes a shared view',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await SharedViews.delete({ id: input.id });
    return { success: true };
  },
});
