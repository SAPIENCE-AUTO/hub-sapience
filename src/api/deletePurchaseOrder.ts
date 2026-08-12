import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PoLineItems, PoAuditLog, ZiteError } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a purchase order and its line items (with permission checks)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';

    const po = await PurchaseOrders.findOne({ id: input.id, fields: ['createdBy', 'status', 'poNumber'] });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });

    const isCreator = po.createdBy === context.user!.email;
    const canDelete =
      (isCreator && po.status === 'Borrador') ||
      (level === 'Finanzas' && po.status === 'Borrador') ||
      (level === 'Socios');

    if (!canDelete) {
      throw new ZiteError({
        code: 'FORBIDDEN',
        message: 'No tienes permiso para eliminar esta OC. Solo se pueden eliminar OCs en Borrador.',
      });
    }

    // Log before deleting (so the PO still exists for the linked record)
    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.id,
        action: 'Eliminada',
        userEmail: context.user!.email,
        userName,
        poNumber: String(po.poNumber ?? ''),
      },
    });

    const { records } = await PoLineItems.findAll({ filters: { poId: input.id }, limit: 200 });
    for (const item of records) {
      await PoLineItems.delete({ id: item.id });
    }
    await PurchaseOrders.delete({ id: input.id });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'deleted', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true };
  },
});
