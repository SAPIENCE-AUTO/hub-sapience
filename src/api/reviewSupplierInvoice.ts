import { z } from 'zod';
import { createEndpoint, SupplierInvoices, Payments, Suppliers } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Validate or reject a supplier invoice. When validating, auto-creates a scheduled payment. When rejecting, notifies the supplier by email.',
  authenticated: true,
  inputSchema: z.object({
    invoiceId: z.string(),
    action: z.enum(['validar', 'rechazar']),
    notes: z.string().optional(),
    scheduledPaymentDate: z.string().optional(), // ISO date string, required when action = 'validar'
    // Validated tax breakdown (editable by reviewer before approving)
    validatedSubtotal: z.number().optional(),
    validatedIvaRate: z.number().optional(),
    validatedIvaAmount: z.number().optional(),
    validatedRetencionIva: z.number().optional(),
    validatedRetencionIsr: z.number().optional(),
    validatedTotal: z.number().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), paymentId: z.string().optional(), emailSent: z.boolean().optional() }),
  execute: async ({ input, context }) => {
    const status = input.action === 'validar' ? 'Validada' : 'Rechazada';

    // Build the record update — include validated tax breakdown when validating
    const invoiceUpdate: Record<string, unknown> = {
      status,
      reviewedBy: context.user!.email,
      reviewedAt: new Date().toISOString(),
      reviewNotes: input.notes,
    };
    if (input.action === 'validar') {
      if (input.validatedSubtotal !== undefined) invoiceUpdate.subtotal = input.validatedSubtotal;
      if (input.validatedIvaRate !== undefined) invoiceUpdate.ivaRate = input.validatedIvaRate;
      if (input.validatedIvaAmount !== undefined) invoiceUpdate.ivaAmount = input.validatedIvaAmount;
      if (input.validatedRetencionIva !== undefined) invoiceUpdate.retencionIva = input.validatedRetencionIva;
      if (input.validatedRetencionIsr !== undefined) invoiceUpdate.retencionIsr = input.validatedRetencionIsr;
      if (input.validatedTotal !== undefined) invoiceUpdate.amount = input.validatedTotal;
    }

    // Update invoice status
    await SupplierInvoices.update({
      id: input.invoiceId,
      record: invoiceUpdate,
    });

    // If validating, create a scheduled payment
    if (input.action === 'validar') {
      const invoice = await SupplierInvoices.findOne({ id: input.invoiceId });
      if (invoice) {
        // Use the validated total if provided, fall back to stored amount
        const paymentAmount = input.validatedTotal ?? invoice.amount;
        const payment = await Payments.create({
          record: {
            type: 'Pago a proveedor',
            poId: invoice.poId,
            supplierName: invoice.supplierName,
            supplierInvoiceNumber: invoice.invoiceNumber,
            amount: paymentAmount,
            currency: invoice.currency ?? 'MXN',
            projectCode: invoice.projectCode,
            dueDate: input.scheduledPaymentDate,
            status: 'Programado',
            notes: `Pago programado automáticamente al validar factura ${invoice.invoiceNumber ?? ''}`,
          },
        });
        return { success: true, paymentId: payment.id };
      }
    }

    // If rejecting, send email notification to supplier
    if (input.action === 'rechazar') {
      let emailSent = false;
      try {
        const invoice = await SupplierInvoices.findOne({ id: input.invoiceId });
        if (invoice?.supplierName) {
          const supplier = await Suppliers.findOne({ filters: { supplierName: invoice.supplierName } });
          const recipientEmail = supplier?.email;
          const accessToken = process.env.ZITE_OUTLOOK_ACCESS_TOKEN;

          if (recipientEmail && accessToken) {
            const contactName = supplier?.contactName || invoice.supplierName;
            const invoiceNumber = invoice.invoiceNumber ?? 'Sin número';
            const amount = invoice.amount != null
              ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: invoice.currency ?? 'MXN' }).format(invoice.amount)
              : '—';
            const rejectionNotes = input.notes || 'No se especificó un motivo.';
            const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;

            const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="font-size: 16px;">Estimado/a <strong>${contactName}</strong>,</p>

  <p>Hemos revisado la factura que nos enviaste y hemos detectado que <strong>requiere correcciones</strong> antes de poder procesarla.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #ddd; width: 40%;">Número de factura</td>
      <td style="padding: 10px 14px; border: 1px solid #ddd;">${invoiceNumber}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #ddd;">Monto</td>
      <td style="padding: 10px 14px; border: 1px solid #ddd;">${amount}</td>
    </tr>
  </table>

  <p style="font-weight: bold; margin-bottom: 6px;">Motivo del rechazo:</p>
  <div style="background-color: #fff3cd; border-left: 4px solid #f0ad4e; padding: 14px 18px; border-radius: 4px; font-size: 14px; margin-bottom: 20px;">
    ${rejectionNotes}
  </div>

  <p>Por favor, realiza las correcciones necesarias y reenvía la factura corregida lo antes posible para que podamos continuar con el proceso de pago.</p>

  <p>Si tienes alguna duda, no dudes en contactarnos respondiendo a este correo.</p>

  <br>
  <p style="color: #555;">Saludos,<br>
  <strong>Equipo de Compras — Sapience</strong></p>
</body>
</html>`;

            const mailPayload = {
              message: {
                subject: `Factura ${invoiceNumber} — Corrección requerida`,
                body: { contentType: 'HTML', content: htmlBody },
                toRecipients: [{ emailAddress: { address: recipientEmail } }],
                ...(sendAsEmail ? { from: { emailAddress: { address: sendAsEmail } } } : {}),
              },
              saveToSentItems: true,
            };

            const graphResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(mailPayload),
            });

            if (graphResp.ok) {
              emailSent = true;
            } else {
              const errText = await graphResp.text().catch(() => '');
              console.error(`Error al enviar email de rechazo (${graphResp.status}): ${errText.slice(0, 300)}`);
            }
          }
        }
      } catch (err) {
        console.error('Error inesperado al enviar email de rechazo de factura:', err);
      }

      return { success: true, emailSent };
    }

    return { success: true };
  },
});
