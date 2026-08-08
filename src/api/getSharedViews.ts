import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

export default createEndpoint({
  authenticated: true,
  description: 'Lists all shared views for a board (dual-read: UUID + legacy)',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({
    views: z.array(z.object({
      id: z.string(),
      viewName: z.string().optional(),
      token: z.string().optional(),
      filtersJson: z.string().optional(),
      visibleColumnsJson: z.string().optional(),
      active: z.boolean().optional(),
      shareUrl: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    // Dual-read: fetch under input boardId + its counterpart (UUID↔legacy)
    const boardIdsToSearch = new Set<string>([input.boardId]);

    try {
      const resolved = await resolveBoardId({
        boardIdOrKey: input.boardId,
        fallbackToLegacy: true,
      });
      boardIdsToSearch.add(resolved.baseBoardId);
      boardIdsToSearch.add(resolved.legacyBaseId);
    } catch { /* keep just the input boardId */ }

    const seenIds = new Set<string>();
    const allViews: any[] = [];

    for (const bid of boardIdsToSearch) {
      const { records: views } = await SharedViews.findAll({
        filters: { boardId: bid },
      });
      for (const v of views) {
        if (!seenIds.has(v.id)) {
          seenIds.add(v.id);
          allViews.push(v);
        }
      }
    }

    const appUrl = process.env.ZITE_APP_URL ?? '';
    return {
      views: allViews.map(v => ({
        id: v.id,
        viewName: v.viewName,
        token: v.token,
        filtersJson: v.filtersJson,
        visibleColumnsJson: v.visibleColumnsJson,
        active: v.active,
        shareUrl: `${appUrl}/shared/${v.token ?? ''}`,
      })),
    };
  },
});
