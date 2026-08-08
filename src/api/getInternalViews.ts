import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

export default createEndpoint({
  description: 'Returns all internal (saved filter) views for a board, sorted by viewOrder (dual-read: UUID + legacy)',
  authenticated: true,
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({
    views: z.array(z.object({
      id: z.string(),
      viewName: z.string(),
      filtersJson: z.string(),
      visibleColumnsJson: z.string().optional(),
      sharedToken: z.string().optional(),
      sharedUrl: z.string().optional(),
      viewOrder: z.number().optional(),
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
      const { records } = await SharedViews.findAll({
        filters: { boardId: bid, type: 'Internal' },
        limit: 200,
      });
      for (const v of records) {
        if (!seenIds.has(v.id)) {
          seenIds.add(v.id);
          allViews.push(v);
        }
      }
    }

    // Sort by viewOrder ascending; records without order go to the end
    const sorted = allViews.sort((a, b) => {
      const aOrder = a.viewOrder ?? Infinity;
      const bOrder = b.viewOrder ?? Infinity;
      return aOrder - bOrder;
    });

    const appUrl = process.env.ZITE_APP_URL ?? '';

    return {
      views: sorted.map(v => ({
        id: v.id,
        viewName: v.viewName ?? 'Sin nombre',
        filtersJson: v.filtersJson ?? '{}',
        visibleColumnsJson: v.visibleColumnsJson ?? undefined,
        sharedToken: v.sharedToken ?? undefined,
        sharedUrl: v.sharedToken ? `${appUrl}/shared/${v.sharedToken}` : undefined,
        viewOrder: v.viewOrder ?? undefined,
      })),
    };
  },
});
