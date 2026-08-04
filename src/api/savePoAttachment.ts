import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders, PoAttachments } from 'zite-integrations-backend-sdk';

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
  description: 'Save an evidence attachment to a purchase order',
  inputSchema: z.object({
    poId: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    description: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), attachment: attachmentSchema }),
  execute: async ({ input, context }) => {
    const po = await PurchaseOrders.findOne({ id: input.poId });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });
    if (po.status === 'Cancelada') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No se pueden adjuntar evidencias a una OC cancelada' });
    }

    const level = context.user!.purchaseLevel ?? 'Creador';
    const costCenters = Array.isArray(context.user!.costCenters) ? (context.user!.costCenters as string[]) : [];
    const isCreator = po.createdBy === context.user!.email;
    const isSameArea = po.category ? costCenters.includes(po.category) : false;
    const isHighLevel = level === 'Finanzas' || level === 'Socios';

    if (!isCreator && !isSameArea && !isHighLevel) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para adjuntar evidencias a esta OC' });
    }

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const now = new Date().toISOString();

    const record = await PoAttachments.create({
      record: {
        name: input.fileName,
        purchaseOrder: input.poId,
        fileUrl: input.fileUrl,
        description: input.description,
        uploadedByEmail: context.user!.email,
        uploadedByName: userName,
        uploadedAt: now,
      },
    });

    return {
      success: true,
      attachment: {
        id: record.id,
        name: record.name ?? input.fileName,
        fileUrl: record.fileUrl ?? input.fileUrl,
        description: record.description,
        uploadedByEmail: record.uploadedByEmail,
        uploadedByName: record.uploadedByName,
        uploadedAt: record.uploadedAt ?? now,
      },
    };
  },
});
