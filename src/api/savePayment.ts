import { z } from 'zod';
import { createEndpoint, Payments, PurchaseOrders } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a payment',
  inputSchema: z.object({
    id: z.string().optional(),
    poId: z.string().optional(),
    supplierName: z.string().optional(),
    projectCode: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    paymentDate: z.string().optional(),
    dueDate: z.string().optional(),
    method: z.string().optional(),
    reference: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
    supplierInvoiceNumber: z.string().optional(),
    destinationAccount: z.string().optional(),
    sourceCompany: z.string().optional(),
    sourceBank: z.string().optional(),
    sourceAccount: z.string().optional(),
    attachment: z.array(z.object({ url: z.string() })).optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const { id, poId, ...rest } = input;

    // If poId provided, enrich from PO
    let supplierName = rest.supplierName;
    let projectCode = rest.projectCode;
    if (poId) {
      const po = await PurchaseOrders.findOne({ id: poId, fields: ['status', 'supplierName', 'projectCode', 'billingEntity'] });
      if (!po) throw new Error('ODC no encontrada.');
      if (po.status !== 'Enviada a aprobación' && po.status !== 'Aprobada') {
        throw new Error(`No se puede registrar un pago para una ODC con status "${po.status}". Solo se permiten ODCs Enviadas o Aprobadas.`);
      }
      supplierName = supplierName || po.supplierName;
      projectCode = projectCode || po.projectCode;
      // Auto-fill sourceCompany from PO's billingEntity if not explicitly provided
      if (!rest.sourceCompany && po.billingEntity) {
        rest.sourceCompany = po.billingEntity;
      }
    }

    const record = {
      ...rest,
      poId,
      supplierName,
      projectCode,
      type: 'Pago a proveedor' as const,
      ...(input.attachment !== undefined ? { attachment: input.attachment } : {}),
    };

    // Auto-fill payment date when marking as Realizado
    if (input.status === 'Realizado' && !input.paymentDate) {
      record.paymentDate = new Date().toISOString().split('T')[0];
    }

    if (id) {
      // Prevent changing status if payment is already Realizado or Cancelado
      if (input.status) {
        const existing = await Payments.findOne({ id });
        if (existing && (existing.status === 'Realizado' || existing.status === 'Cancelado')) {
          throw new Error(`No se puede cambiar el status de un pago "${existing.status}".`);
        }
      }
      await Payments.update({ id, record });
      return { success: true, id };
    }

    // paymentId es autonumber (bigint identity) — lo asigna Postgres, no la app.
    // El código original intentaba escribir un string "PAG-0001"; Zite lo
    // ignoraba en silencio porque el campo es autonumber (los payment_id reales
    // migrados son enteros planos: 310, 309, 308...). Aquí igual: no se escribe.

    // Force Programado status for all new payments
    const created = await Payments.create({ record: { ...record, status: 'Programado' } });
    return { success: true, id: created.id };
  },
});
