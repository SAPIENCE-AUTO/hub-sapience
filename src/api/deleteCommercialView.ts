import { z } from 'zod';
import { createEndpoint, CommercialDashboardViews, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a commercial dashboard view by viewId.',
  inputSchema: z.object({ viewId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const record = await CommercialDashboardViews.findOne({
      filters: { viewId: input.viewId },
    });

    if (!record) throw new ZiteError({ code: 'NOT_FOUND', message: 'Vista no encontrada' });

    await CommercialDashboardViews.delete({ id: record.id });
    return { success: true };
  },
});
