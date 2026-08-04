import { z } from 'zod';
import { createEndpoint, DealDocuments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a deal document',
  inputSchema: z.object({
    id: z.string().optional(),
    documentName: z.string().optional(),
    deal: z.array(z.string()).optional(),
    docType: z.string().optional(),
    version: z.string().optional(),
    fileUrl: z.string().optional(),
    fileName: z.string().optional(),
    uploadDate: z.string().optional(),
    notes: z.string().optional(),
    content: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const { id, ...record } = input;
    if (id) {
      await DealDocuments.update({ id, record });
      return { id };
    }
    const created = await DealDocuments.create({ record });
    return { id: created.id };
  },
});
