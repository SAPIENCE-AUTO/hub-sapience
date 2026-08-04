import { z } from 'zod';
import { createEndpoint, Payments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a payment by id',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Payments.delete({ id: input.id });
    return { success: true };
  },
});
