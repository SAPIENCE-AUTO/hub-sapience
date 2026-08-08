import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PoAuditLog, ZiteError } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Reject a purchase order and return it to Borrador',
  inputSchema: z.object({
    id: z.string(),
    comments: z.string().min(1, 'El motivo del rechazo es obligatorio'),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (level !== 'Aprobador' && level !== 'Finanzas' && level !== 'Socios') throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para rechazar órdenes de compra' });

    const po = await PurchaseOrders.findOne({ id: input.id });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });
    if (po.status !== 'Enviada a aprobación') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden rechazar OCs en estatus Enviada a aprobación' });

    if (level === 'Aprobador') {
      const costCenters = context.user!.costCenters ?? [];
      if (po.category && !costCenters.includes(po.category)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes rechazar OCs de tu área' });
      }
    }

    await PurchaseOrders.update({ id: input.id, record: { status: 'Borrador', rejectionReason: input.comments } });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.id,
        action: 'Rechazada',
        userEmail: context.user!.email,
        userName,
        comments: input.comments,
        poNumber: String(po.poNumber ?? ''),
      },
    });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'rejected', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true };
  },
});
