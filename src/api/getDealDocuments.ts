import { z } from 'zod';
import { createEndpoint, DealDocuments } from '../../server/compat';

const DocOut = z.object({
  id: z.string(),
  documentName: z.string().optional(),
  docType: z.string().optional(),
  version: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  uploadDate: z.string().optional(),
  notes: z.string().optional(),
  content: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get documents for a deal',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({ documents: z.array(DocOut) }),
  execute: async ({ input }) => {
    const result = await DealDocuments.findAll({
      filters: { deal: { contains: input.dealId } },
    });
    const filtered = result.records.filter(r => {
      const ids = Array.isArray(r.deal) ? r.deal : r.deal ? [r.deal] : [];
      return ids.includes(input.dealId);
    });
    return {
      documents: filtered.map(d => ({
        id: d.id,
        documentName: d.documentName,
        docType: d.docType,
        version: d.version,
        fileUrl: d.fileUrl,
        fileName: d.fileName,
        uploadDate: d.uploadDate,
        notes: d.notes,
        content: d.content,
      })),
    };
  },
});
