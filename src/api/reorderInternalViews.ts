import { z } from 'zod';
import { createEndpoint, SharedViews } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Reorder internal views by updating their viewOrder field',
  authenticated: true,
  inputSchema: z.object({
    viewOrders: z.array(z.object({
      id: z.string(),
      order: z.number(),
    })),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Promise.all(
      input.viewOrders.map(({ id, order }) =>
        SharedViews.update({ id, record: { viewOrder: order } })
      )
    );
    return { success: true };
  },
});
