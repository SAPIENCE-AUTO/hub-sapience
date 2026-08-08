import { z } from 'zod';
import { createEndpoint, DocumentBlocks } from '../../server/compat';

export default createEndpoint({
  description: 'Delete a document block',
  authenticated: true,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await DocumentBlocks.delete({ id: input.id });
    return { success: true };
  },
});
