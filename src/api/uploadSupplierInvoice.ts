import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders, SupplierInvoices } from '../../server/compat';

const attachmentSchema = z.array(z.object({ url: z.string() }));

export default createEndpoint({
  authenticated: false,
  description: 'Upload a supplier invoice linked to a PO (public, validated by token + password)',
  inputSchema: z.object({
    token: z.string(),
    password: z.string(),
    poId: z.string(),
    invoiceNumber: z.string(),
    amount: z.number(),
    currency: z.string(),
    subtotal: z.number().optional(),
    ivaRate: z.number().optional(),
    ivaAmount: z.number().optional(),
    retencionIva: z.number().optional(),
    retencionIsr: z.number().optional(),
    pdfFile: attachmentSchema,
    xmlFile: attachmentSchema.optional(),
    supportFile: attachmentSchema.optional(),
    supplierComment: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const supplier = await Suppliers.findOne({ filters: { accessToken: input.token } });
    if (!supplier) throw new Error('Token de acceso inválido.');
    if (supplier.portalPassword !== input.password) throw new Error('Clave de acceso incorrecta.');

    const po = await PurchaseOrders.findOne({ id: input.poId });
    if (!po || po.supplierName !== supplier.supplierName) {
      throw new Error('La orden de compra no corresponde a este proveedor.');
    }

    const created = await SupplierInvoices.create({
      record: {
        invoiceNumber: input.invoiceNumber,
        poId: input.poId,
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        poNumber: String(po.poNumber ?? ''),
        amount: input.amount,
        currency: input.currency,
        subtotal: input.subtotal,
        ivaRate: input.ivaRate,
        ivaAmount: input.ivaAmount,
        retencionIva: input.retencionIva,
        retencionIsr: input.retencionIsr,
        pdfFile: input.pdfFile,
        xmlFile: input.xmlFile,
        supportFile: input.supportFile,
        status: 'Pendiente',
        uploadDate: new Date().toISOString(),
        uploadedBy: supplier.email ?? '',
        projectCode: po.projectCode,
        supplierComment: input.supplierComment,
      },
    });

    return { success: true, id: created.id };
  },
});
