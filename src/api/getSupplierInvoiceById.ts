import { z } from 'zod';
import { createEndpoint, SupplierInvoices, PurchaseOrders } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get full details of a single supplier invoice including file attachments',
  authenticated: true,
  inputSchema: z.object({
    invoiceId: z.string(),
  }),
  outputSchema: z.object({
    invoice: z.object({
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
      subtotal: z.number().optional(),
      ivaRate: z.number().optional(),
      ivaAmount: z.number().optional(),
      retencionIva: z.number().optional(),
      retencionIsr: z.number().optional(),
      currency: z.string().optional(),
      status: z.string().optional(),
      uploadDate: z.string().optional(),
      uploadedBy: z.string().optional(),
      reviewNotes: z.string().optional(),
      reviewedBy: z.string().optional(),
      reviewedAt: z.string().optional(),
      projectCode: z.string().optional(),
      supplierComment: z.string().optional(),
      pdfFile: z.array(z.object({ url: z.string() })).optional(),
      xmlFile: z.array(z.object({ url: z.string() })).optional(),
      supportFile: z.array(z.object({ url: z.string() })).optional(),
    }).nullable(),
  }),
  execute: async ({ input }) => {
    const inv = await SupplierInvoices.findOne({ id: input.invoiceId });
    if (!inv) return { invoice: null };

    let po: { poNumber?: string; totalAmount?: number; serviceDescription?: string; paymentTerms?: string } | undefined;
    if (inv.poId) {
      const poRecord = await PurchaseOrders.findOne({
        id: inv.poId,
        fields: ['poNumber', 'totalAmount', 'serviceDescription', 'paymentTerms'],
      });
      if (poRecord) po = poRecord;
    }

    return {
      invoice: {
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
        subtotal: inv.subtotal,
        ivaRate: inv.ivaRate,
        ivaAmount: inv.ivaAmount,
        retencionIva: inv.retencionIva,
        retencionIsr: inv.retencionIsr,
        currency: inv.currency,
        status: inv.status,
        uploadDate: inv.uploadDate,
        uploadedBy: inv.uploadedBy,
        reviewNotes: inv.reviewNotes,
        reviewedBy: inv.reviewedBy,
        reviewedAt: inv.reviewedAt,
        projectCode: inv.projectCode,
        supplierComment: inv.supplierComment,
        pdfFile: inv.pdfFile,
        xmlFile: inv.xmlFile,
        supportFile: inv.supportFile,
      },
    };
  },
});
