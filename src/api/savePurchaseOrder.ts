import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PoLineItems, PoAuditLog, ZiteError } from '../../server/compat';
import { publishEvent } from '../lib/ably';

const lineItemInput = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  total: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a purchase order with its line items',
  inputSchema: z.object({
    id: z.string().optional(),
    projectCode: z.string().optional(),
    supplierName: z.string().optional(),
    issueDate: z.string().optional(),
    totalAmount: z.number().optional(),
    notes: z.string().optional(),
    category: z.string().optional(),
    paymentTerms: z.string().optional(),
    currency: z.string().optional(),
    serviceDescription: z.string().optional(),
    billingEntity: z.string().optional(),
    orderType: z.string().optional(),
    lineItems: z.array(lineItemInput).optional(),
    deletedLineItemIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    const level = context.user!.purchaseLevel ?? 'Creador';
    const { id, lineItems, deletedLineItemIds, orderType, ...rest } = input;
    const fields = { ...rest, ...(orderType !== undefined ? { tipoDeOc: orderType } : {}) };
    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;

    let poId: string;

    if (id) {
      // Editing existing PO — validate permissions
      const po = await PurchaseOrders.findOne({ id });
      if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });

      if (po.status !== 'Borrador') {
        if (level !== 'Socios') {
          throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo se pueden editar OCs en estatus Borrador' });
        }
      } else {
        // Status is Borrador: creator can edit, Aprobador/Finanzas/Socios can also edit
        const isCreator = po.createdBy === context.user!.email;
        if (!isCreator && (level === 'Creador' || level === 'Visor')) {
          throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo puedes editar tus propias órdenes de compra' });
        }
      }

      await PurchaseOrders.update({ id, record: fields });
      poId = id;

      await PoAuditLog.create({
        record: {
          timestamp: new Date().toISOString(),
          purchaseOrder: id,
          action: 'Editada',
          userEmail: context.user!.email,
          userName,
          poNumber: String(po.poNumber ?? ''),
        },
      });
    } else {
      // Creating new PO — Visor cannot create
      if (level === 'Visor') {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para crear órdenes de compra' });
      }
      const categoryPrefixes: Record<string, string> = {
        'Reclutamiento e Incentivos': 'RI',
        'Logística': 'LG',
        'Moderaciones': 'MD',
        'Management': 'MG',
        'Otros': 'TR',
      };
      const prefix = rest.category ? (categoryPrefixes[rest.category] ?? 'OC') : 'OC';

      const [page1, page2] = await Promise.all([
        PurchaseOrders.findAll({ limit: 2000, fields: ['poNumber'] }),
        PurchaseOrders.findAll({ limit: 2000, fields: ['poNumber'], offset: 2000 }),
      ]);
      const allPoNumbers = [...page1.records, ...page2.records]
        .map(r => String(r.poNumber ?? ''))
        .filter(Boolean);

      // Find the max number among existing POs in the 03xxx series for this prefix
      const seriesPrefix = `${prefix}-03`;
      const seriesNums = allPoNumbers
        .filter(n => n.startsWith(seriesPrefix))
        .map(n => parseInt(n.slice(prefix.length + 1), 10))
        .filter(n => !isNaN(n));
      const maxNum = seriesNums.length > 0 ? Math.max(...seriesNums) : 3000;
      const nextNum = maxNum + 1;
      const poNumber = `${prefix}-${String(nextNum).padStart(5, '0')}`;

      const record = await PurchaseOrders.create({
        record: { ...fields, poNumber, createdBy: context.user!.email, status: 'Borrador', origen: 'Sistema' },
      });
      poId = record.id;

      await PoAuditLog.create({
        record: {
          timestamp: new Date().toISOString(),
          purchaseOrder: poId,
          action: 'Creada',
          userEmail: context.user!.email,
          userName,
          poNumber,
        },
      });
    }

    if (deletedLineItemIds && deletedLineItemIds.length > 0) {
      for (const itemId of deletedLineItemIds) {
        await PoLineItems.delete({ id: itemId });
      }
    }

    if (lineItems && lineItems.length > 0) {
      const toCreate = lineItems.filter(i => !i.id).map(({ id: _id, ...item }) => ({ ...item, poId }));
      const toUpdate = lineItems.filter(i => !!i.id);
      if (toCreate.length > 0) await PoLineItems.bulkCreate({ records: toCreate });
      for (const item of toUpdate) {
        const { id: itemId, ...itemFields } = item;
        await PoLineItems.update({ id: itemId!, record: { ...itemFields, poId } });
      }
    }

    try { await publishEvent('purchases:global', 'po.changed', { id: poId, action: id ? 'updated' : 'created', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true, id: poId };
  },
});
