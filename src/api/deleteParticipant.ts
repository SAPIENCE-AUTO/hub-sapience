import { z } from 'zod';
import { createEndpoint, Participants } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a participant',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Participants.delete({ id: input.id });
    return { success: true };
  },
});
