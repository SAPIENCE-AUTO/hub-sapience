import { z } from 'zod';
import { createEndpoint, DocumentBlocks } from '../../server/compat';

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
  description: 'Get a single document block by ID',
  authenticated: true,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ block: BlockOut.nullable() }),
  execute: async ({ input }) => {
    const record = await DocumentBlocks.findOne({ id: input.id });
    if (!record) return { block: null };
    return {
      block: {
        id: record.id,
        blockType: record.blockType ?? undefined,
        content: record.blockContent ?? undefined,
        documentJson: (record as any).documentJson ?? undefined,
        authorName: record.authorName ?? undefined,
        authorEmail: record.authorEmail ?? undefined,
        sortOrder: record.sortOrder ?? undefined,
        createdAt: record.createdAt ?? undefined,
        updatedAt: record.updatedAt ?? undefined,
        checklistData: record.checklistData ?? undefined,
      },
    };
  },
});
