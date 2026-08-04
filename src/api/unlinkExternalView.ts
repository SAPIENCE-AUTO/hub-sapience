import { z } from 'zod';
import { createEndpoint, SharedViews } from 'zite-integrations-backend-sdk';

/**
 * Removes the external shared view linked to an internal view,
 * and clears the sharedToken field on the internal view so a new one can be created later.
 */
export default createEndpoint({
  description: 'Unlinks and deletes the external shared view associated with an internal view',
  authenticated: true,
  inputSchema: z.object({
    internalViewId: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const internalView = await SharedViews.findOne({ id: input.internalViewId });
    if (!internalView) throw new Error('Vista interna no encontrada');

    const existingToken = internalView.sharedToken;

    if (existingToken) {
      // Find and delete the external view stub
      const externalView = await SharedViews.findOne({
        filters: { token: existingToken, type: 'External' },
      });
      if (externalView) {
        await SharedViews.delete({ id: externalView.id });
      }

      // Clear sharedToken from the internal view
      await SharedViews.update({
        id: input.internalViewId,
        record: { sharedToken: '' },
      });
    }

    return { success: true };
  },
});
