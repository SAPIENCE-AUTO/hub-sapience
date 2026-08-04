import { z } from 'zod';
import { createEndpoint, SharedViews } from 'zite-integrations-backend-sdk';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

export default createEndpoint({
  description: 'Create or update an internal (saved filter) view',
  authenticated: true,
  inputSchema: z.object({
    id: z.string().optional(),
    viewName: z.string(),
    boardId: z.string(),
    projectCode: z.string(),
    boardName: z.string(),
    filtersJson: z.string(),
    visibleColumnsJson: z.string().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    viewName: z.string(),
  }),
  execute: async ({ input, context }) => {
    if (input.id) {
      // Update existing — no boardId change needed
      const updated = await SharedViews.update({
        id: input.id,
        record: {
          viewName: input.viewName,
          filtersJson: input.filtersJson,
          visibleColumnsJson: input.visibleColumnsJson,
        },
      });
      return { id: updated.id, viewName: input.viewName };
    }

    // ── Create new view ─────────────────────────────────────────────────

    // Resolve boardId to UUID
    const resolved = await resolveWriteBoardId(input.boardId, {
      projectCode: input.projectCode,
      boardName: input.boardName,
      boardType: 'recruitment',
    });
    const effectiveBoardId = resolved.writeBoardId;

    // Anti-duplicate: check under both UUID and legacy for existing views
    const boardIdsToCheck = [effectiveBoardId];
    if (resolved.legacyBoardId && resolved.legacyBoardId !== effectiveBoardId) {
      boardIdsToCheck.push(resolved.legacyBoardId);
    }
    // Also check input.boardId if different
    if (!boardIdsToCheck.includes(input.boardId)) {
      boardIdsToCheck.push(input.boardId);
    }

    let totalViewCount = 0;
    for (const bid of boardIdsToCheck) {
      const { records } = await SharedViews.findAll({
        filters: { boardId: bid, type: 'Internal' },
        limit: 200,
      });

      // Check for equivalent view under legacy that should be moved to UUID
      if (bid !== effectiveBoardId) {
        const equivalent = records.find(v =>
          v.viewName === input.viewName && v.active !== false,
        );
        if (equivalent) {
          // Move to UUID instead of creating duplicate
          await SharedViews.update({
            id: equivalent.id,
            record: {
              boardId: effectiveBoardId,
              filtersJson: input.filtersJson,
              visibleColumnsJson: input.visibleColumnsJson,
            },
          });
          console.log('[saveInternalView] Moved existing legacy view to UUID', {
            id: equivalent.id, from: bid, to: effectiveBoardId,
          });
          return { id: equivalent.id, viewName: equivalent.viewName ?? input.viewName };
        }
      }

      totalViewCount += records.length;
    }

    const created = await SharedViews.create({
      record: {
        viewName: input.viewName,
        boardId: effectiveBoardId,
        projectCode: input.projectCode,
        boardName: input.boardName,
        filtersJson: input.filtersJson,
        visibleColumnsJson: input.visibleColumnsJson,
        createdBy: context.user!.email,
        active: true,
        type: 'Internal',
        viewOrder: totalViewCount,
      },
    });
    return { id: created.id, viewName: created.viewName ?? input.viewName };
  },
});
