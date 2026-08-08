import { z } from 'zod';
import { createEndpoint, ZiteError, PoAttachments } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Delete an evidence attachment from a purchase order',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const att = await PoAttachments.findOne({ id: input.id });
    if (!att) throw new ZiteError({ code: 'NOT_FOUND', message: 'Evidencia no encontrada' });

    const level = context.user!.purchaseLevel ?? 'Creador';
    const isHighLevel = level === 'Finanzas' || level === 'Socios';
    const isOwner = att.uploadedByEmail === context.user!.email;

    if (!isOwner && !isHighLevel) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes eliminar tus propias evidencias' });
    }

    await PoAttachments.delete({ id: input.id });
    return { success: true };
  },
});
