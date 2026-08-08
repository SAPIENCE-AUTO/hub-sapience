import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';
import { randomUUID } from 'crypto';

/**
 * Atomically creates-or-maintains the external shared view linked to an internal view.
 * The external view is only a token stub — filters and column visibility are always
 * read live from the internal view by getSharedViewData, so no filter copying is needed.
 *
 * - If the internal view already has a sharedToken → verify the external view exists
 *   (recreate if it was deleted) and return the same URL.
 * - If not → create a fresh external shared view stub, then save its token back to
 *   the internal view so future calls reuse it.
 */
export default createEndpoint({
  description: 'Create or maintain the external shared view token linked to an internal view (idempotent)',
  authenticated: true,
  inputSchema: z.object({
    internalViewId: z.string(),
    viewName: z.string(),
    boardId: z.string(),
    projectCode: z.string(),
    boardName: z.string(),
  }),
  outputSchema: z.object({
    shareUrl: z.string(),
    sharedToken: z.string(),
    isNew: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const appUrl = process.env.ZITE_APP_URL ?? '';

    // Load the internal view to check if it already has a linked external view
    const internalView = await SharedViews.findOne({ id: input.internalViewId });
    if (!internalView) throw new Error('Vista interna no encontrada');

    const existingToken = internalView.sharedToken;

    if (existingToken) {
      // ── Verify external view still exists ────────────────────────────
      const externalView = await SharedViews.findOne({ filters: { token: existingToken, type: 'External' } });

      if (externalView) {
        // Update viewName in case it was renamed
        if (externalView.viewName !== `🔗 ${input.viewName}`) {
          await SharedViews.update({
            id: externalView.id,
            record: { viewName: `🔗 ${input.viewName}` },
          });
        }
        return {
          shareUrl: `${appUrl}/shared/${existingToken}`,
          sharedToken: existingToken,
          isNew: false,
        };
      }
      // External view was deleted — fall through to recreate it below
    }

    // ── CREATE new external view stub ─────────────────────────────────────
    const newToken = randomUUID();

    await SharedViews.create({
      record: {
        viewName: `🔗 ${input.viewName}`,
        boardId: input.boardId,
        projectCode: input.projectCode,
        boardName: input.boardName,
        token: newToken,
        createdBy: context.user!.email,
        active: true,
        type: 'External',
      },
    });

    // Save the new token back to the internal view so future calls reuse it
    await SharedViews.update({
      id: input.internalViewId,
      record: { sharedToken: newToken },
    });

    return {
      shareUrl: `${appUrl}/shared/${newToken}`,
      sharedToken: newToken,
      isNew: true,
    };
  },
});
