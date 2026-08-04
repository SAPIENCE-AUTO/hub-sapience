import { z } from 'zod';
import { createEndpoint, Projects } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a project',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Projects.delete({ id: input.id });
    return { success: true };
  },
});
