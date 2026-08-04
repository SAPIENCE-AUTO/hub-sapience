import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders, PoLineItems, Suppliers, BillingEntities } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Generate PDF for a purchase order via n8n webhook (Respond to Webhook)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean(), message: z.string(), pdfUrl: z.string().optional(), pdfBase64: z.string().optional() }),
  execute: async ({ input }) => {
    const webhookUrl = process.env.ZITE_N8N_ODC_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new ZiteError({
        code: 'BAD_REQUEST',
        message: 'El webhook de PDF no está configurado. Agrega ZITE_N8N_ODC_WEBHOOK_URL en los secrets de la app.',
      });
    }

    const po = await PurchaseOrders.findOne({ id: input.id });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'OC no encontrada' });

    const [{ records: lineItems }, supplierResult, billingEntityResult] = await Promise.all([
      PoLineItems.findAll({ filters: { poId: input.id }, limit: 200 }),
      po.supplierName
        ? Suppliers.findOne({ filters: { supplierName: po.supplierName } })
        : Promise.resolve(undefined),
      po.billingEntity
        ? BillingEntities.findOne({ filters: { companyName: po.billingEntity } })
        : Promise.resolve(undefined),
    ]);

    const grandTotal = lineItems.reduce((sum, l) => sum + (l.total ?? 0), 0);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        po: {
          id: po.id,
          poNumber: String(po.poNumber ?? ''),
          projectCode: po.projectCode ?? '',
          supplierName: po.supplierName ?? '',
          issueDate: po.issueDate ?? '',
          totalAmount: po.totalAmount ?? 0,
          status: po.status ?? '',
          category: po.category ?? '',
          paymentTerms: po.paymentTerms ?? '',
          currency: po.currency ?? 'MXN',
          createdBy: po.createdBy ?? '',
          approvedBy: po.approvedBy ?? '',
          notes: po.notes ?? '',
          serviceDescription: po.serviceDescription ?? '',
          billingEntity: po.billingEntity ?? '',
        },
        supplier: {
          name: supplierResult?.supplierName ?? po.supplierName ?? '',
          rfc: supplierResult?.taxId ?? '',
          email: supplierResult?.email ?? '',
          phone: supplierResult?.phone ?? '',
          contactName: supplierResult?.contactName ?? '',
        },
        billingEntity: {
          companyName: billingEntityResult?.companyName ?? po.billingEntity ?? '',
          rfc: billingEntityResult?.rfc ?? '',
          address: billingEntityResult?.address ?? '',
          postalCode: billingEntityResult?.postalCode ?? '',
          city: billingEntityResult?.city ?? '',
          state: billingEntityResult?.state ?? '',
          fullAddress: [
            billingEntityResult?.address,
            billingEntityResult?.city,
            billingEntityResult?.state,
            billingEntityResult?.postalCode ? `CP. ${billingEntityResult.postalCode}` : '',
          ].filter(Boolean).join(', '),
        },
        lineItems: lineItems.map(l => ({
          description: l.description ?? '',
          quantity: l.quantity ?? 1,
          unitPrice: l.unitPrice ?? 0,
          total: l.total ?? 0,
          isNegative: (l.total ?? 0) < 0,
        })),
        grandTotal,
        grandTotalFormatted: new Intl.NumberFormat('es-MX', {
          style: 'currency',
          currency: po.currency === 'USD' ? 'USD' : 'MXN',
          maximumFractionDigits: 2,
        }).format(grandTotal),
      }),
    });

    let raw = await response.json() as unknown;
    const result = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;

    if (result.success === false) {
      throw new ZiteError({
        code: 'INTERNAL_ERROR',
        message: (result.error as string) ?? 'n8n no pudo generar el PDF',
      });
    }

    const pdfUrl = (
      result.pdfUrl ?? result.pdf_url ?? result.url ?? result.fileUrl ?? result.webUrl ?? result.myField
    ) as string | undefined;

    const pdfBase64Check = result.pdfBase64 as string | undefined;

    if (!pdfUrl && !pdfBase64Check) {
      throw new ZiteError({
        code: 'INTERNAL_ERROR',
        message: `n8n respondió sin URL ni base64 de PDF. Campos recibidos: ${Object.keys(result).join(', ')}`,
      });
    }

    const pdfBase64 = result.pdfBase64 as string | undefined;

    if (pdfBase64) {
      console.log('pdfBase64 received from n8n, length:', pdfBase64.length);
    } else {
      console.log('No pdfBase64 in n8n response');
    }

    await PurchaseOrders.update({
      id: input.id,
      record: {
        ...(pdfUrl ? { pdfUrl } : {}),
        ...(pdfBase64 ? { pdfBase64 } : {}),
      },
    });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'pdf_generated', timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true, message: 'PDF generado correctamente', pdfUrl, pdfBase64: pdfBase64 ?? undefined };
  },
});
