import { z } from 'zod';
import { createEndpoint, ZiteError, Payments, Suppliers } from '../../server/compat';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

const fmtCurrency = (amount: number | undefined, currency: string | undefined) => {
  if (amount == null) return '—';
  const sym = currency === 'USD' ? 'USD $' : currency === 'EUR' ? '€' : '$';
  return `${sym}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (d: string | undefined) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return d; }
};

function buildHtml(payment: {
  paymentId?: number | string;
  supplierName?: string;
  amount?: number;
  currency?: string;
  paymentDate?: string;
  dueDate?: string;
  method?: string;
  reference?: string;
  notes?: string;
}, senderName: string, appUrl: string): string {
  const rows = [
    ['Proveedor',        payment.supplierName ?? '—'],
    ['Monto',            fmtCurrency(payment.amount, payment.currency)],
    ['Fecha de pago',    fmtDate(payment.paymentDate)],
    ['Fecha de vencim.', fmtDate(payment.dueDate)],
    ['Método',           payment.method ?? '—'],
    ['Referencia',       payment.reference ?? '—'],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;font-weight:600;color:#6b7280;white-space:nowrap;border-bottom:1px solid #f3f4f6;">${label}</td>
      <td style="padding:8px 12px;color:#111827;border-bottom:1px solid #f3f4f6;">${value}</td>
    </tr>`).join('');

  const notesBlock = payment.notes ? `
    <div style="margin-top:20px;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:600;font-size:13px;color:#6b7280;">Notas</p>
      <p style="margin:0;font-size:14px;color:#374151;">${payment.notes}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1d4ed8;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Comprobante de pago</h1>
            <p style="margin:6px 0 0;color:#bfdbfe;font-size:14px;">Folio #${payment.paymentId ?? '—'}</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:15px;color:#374151;">
              Estimado proveedor, adjuntamos el comprobante del pago realizado. A continuación los detalles:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;">
              ${rows}
            </table>
            ${notesBlock}
            <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6;font-size:13px;color:#9ca3af;">
              Enviado por <strong style="color:#374151;">${senderName}</strong> desde
              <a href="${appUrl}" style="color:#2563eb;text-decoration:none;">Sapience Operations</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export default createEndpoint({
  authenticated: true,
  description: 'Send payment receipt to supplier via Outlook (Microsoft Graph API)',
  inputSchema: z.object({
    paymentId: z.string(),
    newStatus: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
  execute: async ({ input, context }) => {
    // ── Fetch payment ─────────────────────────────────────────────────────
    const payment = await Payments.findOne({ id: input.paymentId });
    if (!payment) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pago no encontrado.' });

    if (!payment.attachment || payment.attachment.length === 0) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este pago no tiene comprobante adjunto.' });
    }

    // ── Find supplier email ────────────────────────────────────────────────
    let recipientEmail: string | undefined;
    if (payment.supplierName) {
      const supplier = await Suppliers.findOne({ filters: { supplierName: payment.supplierName } });
      recipientEmail = supplier?.email;
    }
    if (!recipientEmail) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'El proveedor no tiene email registrado en el catálogo de proveedores.' });
    }

    // ── Build email ───────────────────────────────────────────────────────
    const senderName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const appUrl     = process.env.ZITE_APP_URL ?? '';
    const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;

    const subject = `Comprobante de pago #${payment.paymentId ?? ''} – ${payment.supplierName ?? ''}`;
    const htmlBody = buildHtml(payment as Parameters<typeof buildHtml>[0], senderName, appUrl);

    // ── Download attachment and convert to base64 ─────────────────────────
    const attachments: unknown[] = [];
    for (const att of payment.attachment as Array<{ url: string; filename?: string }>) {
      try {
        const resp = await fetch(att.url);
        if (!resp.ok) continue;
        const buffer = await resp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const ext    = (att.url.split('?')[0].split('.').pop() ?? 'pdf').toLowerCase();
        const mime   = ext === 'pdf' ? 'application/pdf'
                     : ext === 'png' ? 'image/png'
                     : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                     : 'application/octet-stream';
        const name   = att.filename ?? `comprobante-${payment.paymentId ?? 'pago'}.${ext}`;
        attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name,
          contentType: mime,
          contentBytes: base64,
        });
      } catch {
        // Skip attachment on download error — still send the email
      }
    }

    // ── Send via Microsoft Graph ──────────────────────────────────────────
    const mailPayload = {
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: recipientEmail } }],
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

    // ── Optionally update payment status ──────────────────────────────────
    if (input.newStatus) {
      const autoDate = input.newStatus === 'Realizado' && (!payment.paymentDate || payment.paymentDate === '')
        ? { paymentDate: new Date().toISOString().split('T')[0] }
        : {};
      await Payments.update({
        id: input.paymentId,
        record: { status: input.newStatus, ...autoDate },
      });
    }

    const statusSuffix = input.newStatus ? ` — pago marcado como "${input.newStatus}"` : '';
    const attNote      = attachments.length > 0 ? ` con ${attachments.length} adjunto(s)` : ' (sin adjuntos)';
    return { success: true, message: `Comprobante enviado a ${recipientEmail}${attNote}${statusSuffix}` };
  },
});
