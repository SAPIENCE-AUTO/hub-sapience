import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders, SupplierInvoices, Payments, PoAuditLog } from '../../server/compat';

const poSchema = z.object({
  id: z.string(),
  poNumber: z.any().optional(),
  serviceDescription: z.string().optional(),
  totalAmount: z.number().optional(),
  currency: z.string().optional(),
  issueDate: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  projectCode: z.string().optional(),
  paymentTerms: z.string().optional(),
  pdfUrl: z.string().optional(),
  pdfBase64: z.string().optional(),
  pdfFile: z.array(z.object({ url: z.string() })).optional(),
  cancellationReason: z.string().optional(),
  // Embedded invoice (latest for this PO)
  invoiceId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceAmount: z.number().optional(),
  invoiceCurrency: z.string().optional(),
  invoiceStatus: z.string().optional(),
  invoiceUploadDate: z.string().optional(),
  invoiceReviewNotes: z.string().optional(),
  invoiceSubtotal: z.number().optional(),
  invoiceIvaRate: z.number().optional(),
  invoiceIvaAmount: z.number().optional(),
  invoiceRetencionIva: z.number().optional(),
  invoiceRetencionIsr: z.number().optional(),
});

const paymentSchema = z.object({
  id: z.string(),
  paymentId: z.any().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  status: z.string().optional(),
  method: z.string().optional(),
  poNumber: z.string().optional(),
  reference: z.string().optional(),
  attachment: z.array(z.object({ url: z.string() })).optional(),
});

export default createEndpoint({
  description: 'Get supplier portal data (public endpoint, validated by token + password)',
  inputSchema: z.object({ token: z.string(), password: z.string() }),
  outputSchema: z.object({
    supplier: z.object({ id: z.string(), name: z.string(), email: z.string().optional() }),
    purchaseOrders: z.array(poSchema),
    payments: z.array(paymentSchema),
  }),
  execute: async ({ input }) => {
    const supplier = await Suppliers.findOne({ filters: { accessToken: input.token } });
    if (!supplier) throw new Error('Token de acceso inválido.');
    if (supplier.portalPassword !== input.password) throw new Error('Clave de acceso incorrecta.');

    const [posResult, invResult, paymentsResult] = await Promise.all([
      PurchaseOrders.findAll({
        filters: { supplierName: supplier.supplierName },
        limit: 500,
      }),
      SupplierInvoices.findAll({ filters: { supplierId: supplier.id }, limit: 500 }),
      Payments.findAll({ filters: { supplierName: supplier.supplierName }, limit: 500 }),
    ]);

    // Show POs that have both a PDF generated AND an email sent, OR are cancelled (were previously sent)
    const visiblePos = posResult.records.filter(p =>
      (p.pdfUrl || p.pdfBase64 || (p.pdfFile && p.pdfFile.length > 0)) && p.emailSentAt
    );

    // Build PO number map
    const poMap: Record<string, string> = {};
    posResult.records.forEach(p => { poMap[p.id] = String(p.poNumber ?? ''); });

    // Group invoices by poId, keep only the latest per PO
    const latestInvByPo: Record<string, typeof invResult.records[0]> = {};
    invResult.records.forEach(inv => {
      if (!inv.poId) return;
      const existing = latestInvByPo[inv.poId];
      if (!existing) {
        latestInvByPo[inv.poId] = inv;
      } else {
        const existingDate = existing.uploadDate ?? '';
        const newDate = inv.uploadDate ?? '';
        if (newDate > existingDate) latestInvByPo[inv.poId] = inv;
      }
    });

    // Fetch cancellation reasons for cancelled POs
    const cancelledPoIds = visiblePos.filter(p => p.status === 'Cancelada').map(p => p.id);
    const cancelReasonByPoId: Record<string, string> = {};
    if (cancelledPoIds.length > 0) {
      const auditResult = await PoAuditLog.findAll({ filters: { action: 'Cancelada' }, limit: 500 });
      auditResult.records.forEach(log => {
        const poId = Array.isArray(log.purchaseOrder) ? log.purchaseOrder[0] : log.purchaseOrder;
        if (poId && cancelledPoIds.includes(poId) && log.comments && !cancelReasonByPoId[poId]) {
          cancelReasonByPoId[poId] = log.comments;
        }
      });
    }

    return {
      supplier: { id: supplier.id, name: supplier.supplierName ?? '', email: supplier.email },
      purchaseOrders: visiblePos.map(p => {
        const inv = latestInvByPo[p.id];
        return {
          id: p.id,
          poNumber: p.poNumber,
          serviceDescription: p.serviceDescription,
          totalAmount: p.totalAmount,
          currency: p.currency,
          issueDate: p.issueDate,
          status: p.status,
          category: p.category,
          projectCode: p.projectCode,
          paymentTerms: p.paymentTerms,
          pdfUrl: p.pdfUrl,
          pdfBase64: p.pdfBase64,
          pdfFile: p.pdfFile,
          cancellationReason: p.status === 'Cancelada' ? cancelReasonByPoId[p.id] : undefined,
          invoiceId: inv?.id,
          invoiceNumber: inv?.invoiceNumber,
          invoiceAmount: inv?.amount,
          invoiceCurrency: inv?.currency,
          invoiceStatus: inv?.status,
          invoiceUploadDate: inv?.uploadDate,
          invoiceReviewNotes: inv?.reviewNotes,
          invoiceSubtotal: inv?.subtotal,
          invoiceIvaRate: inv?.ivaRate,
          invoiceIvaAmount: inv?.ivaAmount,
          invoiceRetencionIva: inv?.retencionIva,
          invoiceRetencionIsr: inv?.retencionIsr,
        };
      }),
      payments: paymentsResult.records.map(p => ({
        id: p.id,
        paymentId: p.paymentId,
        amount: p.amount,
        currency: p.currency,
        dueDate: p.dueDate,
        paymentDate: p.paymentDate,
        status: p.status,
        method: p.method,
        poNumber: p.poId ? poMap[p.poId] : undefined,
        reference: p.reference,
        attachment: p.attachment,
      })),
    };
  },
});
