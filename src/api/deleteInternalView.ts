import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';

export default createEndpoint({
  description: 'Delete an internal view',
  authenticated: true,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await SharedViews.delete({ id: input.id });
    return { success: true };
  },
});
