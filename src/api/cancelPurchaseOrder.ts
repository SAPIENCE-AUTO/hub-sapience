import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders, PoAuditLog, Suppliers } from '../../server/compat';
import { publishEvent } from '../lib/ably';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

function buildCancellationEmailHtml(poNumber: unknown, totalAmount: number | undefined, currency: string | undefined, reason: string): string {
  const amtFormatted = totalAmount
    ? `${currency === 'USD' ? 'USD ' : '$'}${totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#dc2626;padding:28px 40px;">
            <p style="margin:0;color:#ffffff;font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">Compras Sapience</p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Orden de Compra Cancelada</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
              Le informamos que la <strong>Orden de Compra OC-${poNumber}</strong>${amtFormatted ? ` por <strong>${amtFormatted}</strong>` : ''} ha sido <strong>cancelada</strong> y no podrá ser procesada.
            </p>

            <!-- Motivo -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;padding:16px 20px;">
                  <p style="margin:0 0 6px;color:#991b1b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Motivo de cancelación</p>
                  <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6;">${reason.replace(/\n/g, '<br>')}</p>
                </td>
              </tr>
            </table>

            <!-- Aviso de pago -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:16px 20px;">
                  <p style="margin:0;color:#78350f;font-size:14px;line-height:1.6;">
                    ⚠️ <strong>Aviso importante:</strong> Cualquier pago asociado a esta orden de compra queda sin efecto a partir de esta notificación.
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.6;">
              Si tiene alguna pregunta o requiere mayor información, por favor no dude en contactar a nuestro departamento de compras.
            </p>

            <!-- Contacto -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:20px;">
              <tr>
                <td>
                  <p style="margin:0 0 8px;color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Contacto</p>
                  <p style="margin:0;color:#111827;font-size:14px;">Departamento de Compras — Sapience</p>
                  <p style="margin:4px 0 0;"><a href="mailto:compras@sapience.com.mx" style="color:#2563eb;text-decoration:none;font-size:14px;">compras@sapience.com.mx</a> o bien <a href="mailto:admin@sapience.com.mx" style="color:#2563eb;text-decoration:none;font-size:14px;">admin@sapience.com.mx</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Este es un mensaje automático generado por el sistema de compras de Sapience.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export default createEndpoint({
  description: 'Cancel a purchase order (change status to Cancelada)',
  authenticated: true,
  inputSchema: z.object({
    id: z.string(),
    comments: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean(), emailSent: z.boolean() }),
  execute: async ({ input, context }) => {
    const user = context.user!;
    const po = await PurchaseOrders.findOne({ id: input.id });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'Orden de compra no encontrada' });

    // Cannot cancel if already Pagada or Cancelada
    if (po.status === 'Pagada' || po.status === 'Cancelada') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: `No se puede cancelar una OC en estado "${po.status}"` });
    }

    // Permission check: creator, or PO category is in user's cost centers, or Finanzas/Socios
    const level = user.purchaseLevel ?? 'Creador';
    const costCenters = Array.isArray(user.costCenters) ? (user.costCenters as string[]) : [];
    const isCreator = po.createdBy === user.email;
    const isSameArea = po.category ? costCenters.includes(po.category) : false;
    const isHighLevel = level === 'Finanzas' || level === 'Socios';

    if (!isCreator && !isSameArea && !isHighLevel) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para cancelar esta OC' });
    }

    await PurchaseOrders.update({ id: input.id, record: { status: 'Cancelada' } });

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.id,
        action: 'Cancelada',
        userEmail: user.email,
        userName,
        comments: input.comments,
        poNumber: po.poNumber,
      },
    });

    // Send cancellation email to supplier if PO was previously sent
    let emailSent = false;
    if (po.emailSentAt && po.supplierName) {
      try {
        const supplier = await Suppliers.findOne({ filters: { supplierName: po.supplierName } });
        const recipientEmail = supplier?.email ?? po.emailSentTo;
        if (recipientEmail) {
          const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;
          const htmlBody = buildCancellationEmailHtml(po.poNumber, po.totalAmount, po.currency, input.comments);
          const mailPayload = {
            message: {
              subject: `Cancelación de Orden de Compra OC-${po.poNumber}`,
              body: { contentType: 'HTML', content: htmlBody },
              toRecipients: [{ emailAddress: { address: recipientEmail } }],
              ...(sendAsEmail ? { from: { emailAddress: { address: sendAsEmail } } } : {}),
            },
            saveToSentItems: true,
          };
          const resp = await graphFetch(`${graphMailboxBase()}/sendMail`, {
            method: 'POST',
            body: JSON.stringify(mailPayload),
          });
          if (resp.ok) {
            emailSent = true;
            await PoAuditLog.create({
              record: {
                timestamp: new Date().toISOString(),
                purchaseOrder: input.id,
                action: 'Email enviado',
                userEmail: user.email,
                userName,
                comments: `Email de cancelación enviado a ${recipientEmail}`,
                poNumber: String(po.poNumber ?? ''),
              },
            });
          } else {
            const err = await resp.text().catch(() => '');
            console.log('Cancellation email failed:', resp.status, err.slice(0, 300));
          }
        }
      } catch (err) {
        console.log('Error sending cancellation email:', err);
      }
    }

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'cancelled', senderEmail: user.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true, emailSent };
  },
});
