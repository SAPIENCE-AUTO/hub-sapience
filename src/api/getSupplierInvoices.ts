import { z } from 'zod';
import { createEndpoint, SupplierInvoices, PurchaseOrders } from '../../server/compat';

const invoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string().optional(),
  supplierId: z.string().optional(),
  supplierName: z.string().optional(),
  poId: z.string().optional(),
  poNumber: z.string().optional(),
  poTotalAmount: z.number().optional(),
  poServiceDescription: z.string().optional(),
  poPaymentTerms: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  uploadDate: z.string().optional(),
  uploadedBy: z.string().optional(),
  projectCode: z.string().optional(),
});

export default createEndpoint({
  description: 'Get all supplier invoices for internal review (lightweight list)',
  authenticated: true,
  inputSchema: z.object({
    status: z.string().optional(),
    supplierName: z.string().optional(),
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({
    invoices: z.array(invoiceSchema),
    stats: z.object({
      pending: z.number(),
      inReview: z.number(),
      validated: z.number(),
      rejected: z.number(),
      totalAmount: z.number(),
    }),
  }),
  execute: async ({ input }) => {
    // Only fetch the fields needed for the list view — NO attachments
    const invResult = await SupplierInvoices.findAll({
      limit: 500,
      fields: [
        'invoiceNumber', 'supplierId', 'supplierName', 'poId', 'poNumber',
        'amount', 'currency', 'status', 'uploadDate', 'uploadedBy', 'projectCode',
      ],
    });

    const uniquePoIds = [...new Set(invResult.records.map(inv => inv.poId).filter(Boolean))] as string[];

    const posResult = uniquePoIds.length > 0
      ? await PurchaseOrders.findAll({
          filters: { id: { in: uniquePoIds } },
          limit: 500,
          fields: ['poNumber', 'totalAmount', 'serviceDescription', 'paymentTerms'],
        })
      : { records: [] as { id: string; poNumber?: string; totalAmount?: number; serviceDescription?: string; paymentTerms?: string }[] };

    const poMap: Record<string, { poNumber: string; totalAmount: number; serviceDescription: string; paymentTerms: string }> = {};
    posResult.records.forEach(po => {
      poMap[po.id] = {
        poNumber: String(po.poNumber ?? ''),
        totalAmount: po.totalAmount ?? 0,
        serviceDescription: po.serviceDescription ?? '',
        paymentTerms: po.paymentTerms ?? '',
      };
    });

    let invoices = invResult.records.map(inv => {
      const po = inv.poId ? poMap[inv.poId] : undefined;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId,
        supplierName: inv.supplierName,
        poId: inv.poId,
        poNumber: po?.poNumber ?? inv.poNumber,
        poTotalAmount: po?.totalAmount,
        poServiceDescription: po?.serviceDescription,
        poPaymentTerms: po?.paymentTerms,
        amount: inv.amount,
        currency: inv.currency,
        status: inv.status,
        uploadDate: inv.uploadDate,
        uploadedBy: inv.uploadedBy,
        projectCode: inv.projectCode,
      };
    });

    if (input.status) invoices = invoices.filter(i => i.status === input.status);
    if (input.supplierName) invoices = invoices.filter(i => i.supplierName?.toLowerCase().includes(input.supplierName!.toLowerCase()));
    if (input.projectCode) invoices = invoices.filter(i => i.projectCode === input.projectCode);

    const now = new Date();
    const thisMonth = (s: string) => { const d = new Date(s); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };

    const stats = {
      pending: invResult.records.filter(i => i.status === 'Pendiente').length,
      inReview: invResult.records.filter(i => i.status === 'En revisión').length,
      validated: invResult.records.filter(i => i.status === 'Validada' && i.uploadDate && thisMonth(i.uploadDate)).length,
      rejected: invResult.records.filter(i => i.status === 'Rechazada').length,
      totalAmount: invResult.records.filter(i => i.status === 'Validada').reduce((s, i) => s + (i.amount ?? 0), 0),
    };

    return { invoices, stats };
  },
});
