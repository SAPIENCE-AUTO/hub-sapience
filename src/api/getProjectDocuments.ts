import { z } from 'zod';
import { createEndpoint, Documents } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Fetches all documents for a given project, sorted by uploadDate desc',
  inputSchema: z.object({
    projectCode: z.string(),
  }),
  outputSchema: z.object({
    documents: z.array(z.object({
      id: z.string(),
      documentName: z.string().optional(),
      category: z.string().optional(),
      fileUrl: z.string().optional(),
      version: z.string().optional(),
      uploadDate: z.string().optional(),
      notes: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const result = await Documents.findAll({
      filters: { projectCode: input.projectCode },
      limit: 500,
    });

    const sorted = result.records.sort((a, b) => {
      const da = a.uploadDate ?? '';
      const db = b.uploadDate ?? '';
      return db.localeCompare(da);
    });

    return {
      documents: sorted.map(d => ({
        id: d.id,
        documentName: d.documentName,
        category: d.category,
        fileUrl: d.fileUrl,
        version: d.version,
        uploadDate: d.uploadDate,
        notes: d.notes,
      })),
    };
  },
});
