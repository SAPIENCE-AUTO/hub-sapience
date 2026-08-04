import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Batch update rowOrder for recruitment rows to persist drag-and-drop reordering',
  inputSchema: z.object({
    updates: z.array(z.object({ id: z.string(), rowOrder: z.number() })),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    // Process in chunks of 50 to stay within rate limits
    for (let i = 0; i < input.updates.length; i += 50) {
      const chunk = input.updates.slice(i, i + 50);
      await Promise.all(chunk.map(u => RecruitmentRows.update({ id: u.id, record: { rowOrder: u.rowOrder } })));
    }
    return { success: true };
  },
});
