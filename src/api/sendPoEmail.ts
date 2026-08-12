import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders, PoAuditLog } from '../../server/compat';
import { publishEvent } from '../lib/ably';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>')
    .replace(/\n/g, '<br>\n');
}

export default createEndpoint({
  authenticated: true,
  description: 'Send a purchase order to a supplier via Outlook (Microsoft Graph API)',
  inputSchema: z.object({
    poId: z.string(),
    recipientEmail: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
  execute: async ({ input, context }) => {
    const po = await PurchaseOrders.findOne({ id: input.poId, fields: ['poNumber', 'pdfBase64'] });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'OC no encontrada' });

    // Build email attachments from stored pdfBase64 field
    const attachments: unknown[] = [];

    if (po.pdfBase64) {
      console.log('pdfBase64 found on PO, length:', po.pdfBase64.length);
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: `OC-${po.poNumber}.pdf`,
        contentType: 'application/pdf',
        contentBytes: po.pdfBase64,
      });
    } else {
      console.log('No pdfBase64 stored on this PO — sending without attachment');
    }

    const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;

    const mailPayload = {
      message: {
        subject: input.subject,
        body: {
          contentType: 'HTML',
          content: textToHtml(input.body),
        },
        toRecipients: [{ emailAddress: { address: input.recipientEmail } }],
        ...(sendAsEmail ? { from: { emailAddress: { address: sendAsEmail } } } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      saveToSentItems: true,
    };

    const graphResp = await graphFetch(`${graphMailboxBase()}/sendMail`, {
      method: 'POST',
      body: JSON.stringify(mailPayload),
    });

    if (!graphResp.ok) {
      const errText = await graphResp.text().catch(() => '');
      throw new ZiteError({
        code: 'INTERNAL_ERROR',
        message: `Error al enviar por Outlook (${graphResp.status}): ${errText.slice(0, 300)}`,
      });
    }

    // Update PO record
    await PurchaseOrders.update({
      id: input.poId,
      record: {
        emailSentAt: new Date().toISOString(),
        emailSentTo: input.recipientEmail,
      },
    });

    // Audit log entry
    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await PoAuditLog.create({
      record: {
        timestamp: new Date().toISOString(),
        purchaseOrder: input.poId,
        action: 'Email enviado',
        userEmail: context.user!.email,
        userName,
        poNumber: String(po.poNumber ?? ''),
        comments: `Email enviado a ${input.recipientEmail}`,
      },
    });

    const pdfAttached = attachments.length > 0;
    try { await publishEvent('purchases:global', 'po.changed', { id: input.poId, action: 'email_sent', senderEmail: context.user!.email, timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return {
      success: true,
      message: `OC enviada correctamente a ${input.recipientEmail}${pdfAttached ? ' con PDF adjunto' : ' (sin PDF adjunto — regenera el PDF primero)'}`,
    };
  },
});
