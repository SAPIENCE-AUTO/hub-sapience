import { z } from 'zod';
import { createEndpoint, PoAttachments } from 'zite-integrations-backend-sdk';

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileUrl: z.string(),
  description: z.string().optional(),
  uploadedByEmail: z.string().optional(),
  uploadedByName: z.string().optional(),
  uploadedAt: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get evidence attachments for a purchase order',
  inputSchema: z.object({ poId: z.string() }),
  outputSchema: z.object({ attachments: z.array(attachmentSchema) }),
  execute: async ({ input }) => {
    const { records } = await PoAttachments.findAll({
      filters: { purchaseOrder: input.poId } as never,
      limit: 200,
    });
    return {
      attachments: records.map(r => ({
        id: r.id,
        name: r.name ?? '',
        fileUrl: r.fileUrl ?? '',
        description: r.description,
        uploadedByEmail: r.uploadedByEmail,
        uploadedByName: r.uploadedByName,
        uploadedAt: r.uploadedAt,
      })),
    };
  },
});
