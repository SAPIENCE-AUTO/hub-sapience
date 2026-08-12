import { z } from 'zod';
import { createEndpoint, PurchaseOrders, Suppliers, ZiteError } from '../../server/compat';
import { fmtCurrency } from '../lib/format';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

export default createEndpoint({
  authenticated: true,
  description: 'Prepare a default email draft to send a PO to its supplier',
  inputSchema: z.object({ poId: z.string() }),
  outputSchema: z.object({
    supplierEmail: z.string(),
    supplierName: z.string(),
    contactName: z.string(),
    portalUrl: z.string(),
    portalPassword: z.string(),
    subject: z.string(),
    body: z.string(),
    hasPdf: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const po = await PurchaseOrders.findOne({
      id: input.poId,
      fields: ['supplierName', 'poNumber', 'projectCode', 'totalAmount', 'currency', 'paymentTerms', 'serviceDescription', 'pdfUrl', 'pdfBase64'],
    });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });

    // Find supplier by name
    const { records } = await Suppliers.findAll({
      filters: po.supplierName ? { supplierName: { contains: po.supplierName } } as never : {},
      limit: 1,
    });
    let supplier = records[0];

    let token = supplier?.accessToken ?? '';
    let password = supplier?.portalPassword ?? '';

    // Auto-generate portal token if missing
    if (supplier && !token) {
      token = generateUUID();
      password = randomAlphanumeric(8);
      await Suppliers.update({ id: supplier.id, record: { accessToken: token, portalPassword: password } });
    }

    const appUrl = process.env.ZITE_APP_URL ?? '';
    const portalUrl = token ? `${appUrl}/portal/${token}` : '';
    const supplierEmail = supplier?.email ?? '';
    const supplierName = po.supplierName ?? supplier?.supplierName ?? '';
    const contactName = supplier?.contactName ?? supplierName;
    const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;
    const senderName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const senderEmail = sendAsEmail || context.user!.email;

    const lines: string[] = [
      `Estimado/a ${contactName},`,
      '',
      `Por medio del presente le hacemos llegar la Orden de Compra #${po.poNumber ?? ''} correspondiente al proyecto ${po.projectCode ?? ''}.`,
      '',
      'Detalles de la orden:',
      `• Número de OC: ${po.poNumber ?? ''}`,
      `• Proyecto: ${po.projectCode ?? ''}`,
    ];

    if (po.totalAmount != null) lines.push(`• Monto total: ${fmtCurrency(po.totalAmount, po.currency ?? 'MXN')}`);
    if (po.paymentTerms) lines.push(`• Condiciones de pago: ${po.paymentTerms}`);
    if (po.serviceDescription) lines.push(`• Descripción del servicio: ${po.serviceDescription}`);

    lines.push('', 'El PDF de la orden de compra se encuentra adjunto a este correo.');

    if (portalUrl) {
      lines.push(
        '',
        'Para subir su factura (PDF y XML), por favor acceda al siguiente portal:',
        portalUrl,
      );
    }

    lines.push(
      '',
      'Si tiene alguna duda o requiere información adicional, favor de contactar a: admin@sapience.com.mx',
      '',
      'Nota: Este correo fue enviado desde compras@sapience.com.mx, una dirección que no emite respuestas.',
      '',
      '',
      'Departamento de Compras de SAPIENCE.',
    );

    const subject = [
      `Orden de Compra #${po.poNumber ?? ''}`,
      supplierName,
      po.projectCode,
    ].filter(Boolean).join(' – ');

    return {
      supplierEmail,
      supplierName,
      contactName,
      portalUrl,
      portalPassword: password,
      subject,
      body: lines.join('\n'),
      hasPdf: !!po.pdfUrl || !!po.pdfBase64,
    };
  },
});
