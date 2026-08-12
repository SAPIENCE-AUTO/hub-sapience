import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PoLineItems, PoAuditLog, ZiteError } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Submit a purchase order for approval (Borrador → Enviada a aprobación)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';

    const po = await PurchaseOrders.findOne({ id: input.id, fields: ['status', 'createdBy', 'supplierName', 'totalAmount', 'poNumber'] });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });
    if (po.status !== 'Borrador') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden enviar OCs en estatus Borrador' });

    // Only creator or Finanzas/Socios can submit
    const isCreator = po.createdBy === context.user!.email;
    if (!isCreator && level !== 'Finanzas' && level !== 'Socios') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes enviar tus propias órdenes de compra' });
    }

    if (!po.supplierName) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La OC debe tener un proveedor asignado' });
    if (!po.totalAmount || po.totalAmount <= 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La OC debe tener un monto mayor a cero' });

    const { records: lines } = await PoLineItems.findAll({ filters: { poId: input.id }, limit: 1 });
    if (lines.length === 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La OC debe tener al menos una línea de detalle' });

    await PurchaseOrders.update({ id: input.id, record: { status: 'Enviada a aprobación', rejectionReason: '' } });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.id,
        action: 'Enviada a aprobación',
        userEmail: context.user!.email,
        userName,
        poNumber: String(po.poNumber ?? ''),
      },
    });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'submitted', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true };
  },
});
