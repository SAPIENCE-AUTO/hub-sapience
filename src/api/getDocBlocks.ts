import { z } from 'zod';
import { createEndpoint, DocumentBlocks } from 'zite-integrations-backend-sdk';

const BlockOut = z.object({
  id: z.string(),
  blockType: z.string().optional(),
  content: z.string().optional(),
  documentJson: z.string().optional(),
  authorName: z.string().optional(),
  authorEmail: z.string().optional(),
  sortOrder: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  checklistData: z.string().optional(),
});

export default createEndpoint({
  description: 'Get document blocks for a deal or project minutas, sorted by order',
  authenticated: true,
  inputSchema: z.object({
    dealId: z.string().optional(),
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({ blocks: z.array(BlockOut) }),
  execute: async ({ input }) => {
    const { dealId, projectCode } = input;

    // Minuta path: filter by blockType + checklistData (projectCode stored there)
    if (projectCode) {
      const { records } = await DocumentBlocks.findAll({
        filters: { blockType: 'Minuta', checklistData: projectCode },
        limit: 500,
      });
      return {
        blocks: records
          .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
          .map(r => ({
            id: r.id,
            blockType: r.blockType ?? undefined,
            content: r.blockContent ?? undefined,
            documentJson: (r as any).documentJson ?? undefined,
            authorName: r.authorName ?? undefined,
            authorEmail: r.authorEmail ?? undefined,
            sortOrder: r.sortOrder ?? undefined,
            createdAt: r.createdAt ?? undefined,
            updatedAt: r.updatedAt ?? undefined,
            checklistData: r.checklistData ?? undefined,
          })),
      };
    }

    // Original deal path
    if (!dealId) return { blocks: [] };

    const { records } = await DocumentBlocks.findAll({
      filters: { deal: { contains: dealId } },
      limit: 500,
    });
    const filtered = records
      .filter(r => {
        const ids = Array.isArray(r.deal) ? r.deal : r.deal ? [r.deal] : [];
        return ids.includes(dealId);
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return {
      blocks: filtered.map(r => ({
        id: r.id,
        blockType: r.blockType ?? undefined,
        content: r.blockContent ?? undefined,
        documentJson: (r as any).documentJson ?? undefined,
        authorName: r.authorName ?? undefined,
        authorEmail: r.authorEmail ?? undefined,
        sortOrder: r.sortOrder ?? undefined,
        createdAt: r.createdAt ?? undefined,
        updatedAt: r.updatedAt ?? undefined,
        checklistData: r.checklistData ?? undefined,
      })),
    };
  },
});
