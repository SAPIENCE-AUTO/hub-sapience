import { z } from 'zod';
import { createEndpoint, PurchaseOrders, ApprovalLimits, PoAuditLog, ZiteError } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';
import { fmtCurrency } from '../lib/format';

export default createEndpoint({
  authenticated: true,
  description: 'Approve a purchase order with limit validation',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (level !== 'Aprobador' && level !== 'Finanzas' && level !== 'Socios') throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para aprobar órdenes de compra' });

    const po = await PurchaseOrders.findOne({ id: input.id });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });
    if (po.status !== 'Enviada a aprobación') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden aprobar OCs en estatus "Enviada a aprobación". Primero debe ser enviada a aprobación por su creador.' });
    }

    if (level === 'Aprobador') {
      const costCenters = context.user!.costCenters ?? [];
      if (po.category && !costCenters.includes(po.category)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes aprobar OCs de tu área' });
      }
    }

    // Socios: sin límite de monto
    if (level !== 'Socios') {
      // 1. Límite personal del usuario (tiene prioridad)
      const personalLimit = context.user!.maxApprovalAmount;
      let effectiveLimit: number | null = null;
      let limitSource = '';

      if (personalLimit != null && personalLimit > 0) {
        effectiveLimit = personalLimit;
        limitSource = 'personal';
      } else {
        // 2. Fallback: límite por nivel + centro de costo
        const { records: limits } = await ApprovalLimits.findAll({
          filters: { approvalLevel: level, costCenter: po.category } as never,
          limit: 1,
        });
        if (limits.length > 0 && limits[0].maxAmount != null) {
          effectiveLimit = limits[0].maxAmount;
          limitSource = `del nivel ${level}`;
        }
      }

      if (effectiveLimit != null) {
        const poAmount = po.totalAmount ?? 0;
        if (poAmount > effectiveLimit) {
          throw new ZiteError({
            code: 'FORBIDDEN',
            message: `El monto de esta OC (${fmtCurrency(poAmount)}) excede tu límite de aprobación ${limitSource} (${fmtCurrency(effectiveLimit)}). Se requiere aprobación de un nivel superior.`,
          });
        }
      }
    }

    await PurchaseOrders.update({ id: input.id, record: { status: 'Aprobada', approvedBy: context.user!.email } });

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.id,
        action: 'Aprobada',
        userEmail: context.user!.email,
        userName,
        poNumber: String(po.poNumber ?? ''),
      },
    });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'approved', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true };
  },
});
