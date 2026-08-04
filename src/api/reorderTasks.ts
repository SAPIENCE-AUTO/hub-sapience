import { z } from 'zod';
import { createEndpoint, Tasks } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Batch update order for tasks to persist drag-and-drop reordering',
  inputSchema: z.object({
    updates: z.array(z.object({ id: z.string(), order: z.number() })),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    for (let i = 0; i < input.updates.length; i += 50) {
      const chunk = input.updates.slice(i, i + 50);
      await Promise.all(chunk.map(u => Tasks.update({ id: u.id, record: { order: u.order } })));
    }
    return { success: true };
  },
});
