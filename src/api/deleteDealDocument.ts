import { z } from 'zod';
import { createEndpoint, DealDocuments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a deal document',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await DealDocuments.delete({ id: input.id });
    return { success: true };
  },
});
