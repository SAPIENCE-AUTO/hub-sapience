import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { z } from 'zod';
import { createEndpoint, ZiteError, PurchaseOrders, PoLineItems, Suppliers, BillingEntities } from '../../server/compat';
import { getSupabaseAdmin } from '../../server/supabaseAdmin';
import { publishEvent } from '../lib/ably';

const TEMPLATE_PATH = join(import.meta.dirname, '../../server/templates/odc.html');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d: string | undefined | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return String(d); }
}

// currencyDisplay: 'narrowSymbol' fuerza "$" también para USD — el default de
// Intl para 'es-MX' imprime "USD 1,234.50" (sin signo) para dólares, lo que
// rompería la columna de cifras tabulares de la plantilla. El signo negativo
// es el carácter MINUS SIGN (−, U+2212), no un guion, para calzar con el
// diseño de la plantilla (ver comentario de odc.html).
function fmtMoney(amount: number, currency: 'MXN' | 'USD'): { text: string; neg: boolean } {
  const neg = amount < 0;
  const formatted = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return { text: neg ? `−${formatted}` : formatted, neg };
}

export default createEndpoint({
  authenticated: true,
  description: 'Generate PDF for a purchase order server-side (Puppeteer + server/templates/odc.html)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean(), message: z.string(), pdfUrl: z.string().optional(), pdfBase64: z.string().optional() }),
  execute: async ({ input }) => {
    const po = await PurchaseOrders.findOne({
      id: input.id,
      fields: ['poNumber', 'projectCode', 'supplierName', 'issueDate', 'currency', 'serviceDescription', 'billingEntity'],
    });
    if (!po) throw new ZiteError({ code: 'NOT_FOUND', message: 'OC no encontrada' });

    const [{ records: lineItems }, supplierResult, billingEntityResult] = await Promise.all([
      PoLineItems.findAll({ filters: { poId: input.id }, limit: 200 }),
      po.supplierName
        ? Suppliers.findOne({ filters: { supplierName: po.supplierName }, fields: ['supplierName', 'taxId', 'email'] })
        : Promise.resolve(undefined),
      po.billingEntity
        ? BillingEntities.findOne({ filters: { companyName: po.billingEntity }, fields: ['companyName', 'rfc', 'address', 'city'] })
        : Promise.resolve(undefined),
    ]);

    const currency: 'MXN' | 'USD' = po.currency === 'USD' ? 'USD' : 'MXN';
    const grandTotal = lineItems.reduce((sum, l) => sum + (l.total ?? 0), 0);

    const rowsHtml = lineItems.map(l => {
      const unit = fmtMoney(l.unitPrice ?? 0, currency);
      const sub = fmtMoney(l.total ?? 0, currency);
      return `      <tr>
        <td class="c-concepto">${escapeHtml(l.description ?? '')}</td>
        <td class="c-unitario money${unit.neg ? ' neg' : ''}">${unit.text}</td>
        <td class="c-unidades">${l.quantity ?? 1}</td>
        <td class="c-subtotal money${sub.neg ? ' neg' : ''}">${sub.text}</td>
      </tr>`;
    }).join('\n');

    const replacements: Record<string, string> = {
      odcNumber: escapeHtml(String(po.poNumber ?? '')),
      fecha: fmtDate(po.issueDate),
      moneda: currency,
      proveedorNombre: escapeHtml(supplierResult?.supplierName ?? po.supplierName ?? ''),
      proveedorRfc: escapeHtml(supplierResult?.taxId ?? ''),
      proveedorEmail: escapeHtml(supplierResult?.email ?? ''),
      proyecto: escapeHtml(po.projectCode ?? ''),
      servicio: escapeHtml(po.serviceDescription ?? ''),
      facturarARazon: escapeHtml(billingEntityResult?.companyName ?? po.billingEntity ?? ''),
      facturarARfc: escapeHtml(billingEntityResult?.rfc ?? ''),
      facturarACalle: escapeHtml(billingEntityResult?.address ?? ''),
      facturarACiudad: escapeHtml(billingEntityResult?.city ?? ''),
      total: fmtMoney(grandTotal, currency).text,
    };

    let html = readFileSync(TEMPLATE_PATH, 'utf-8');
    // El comentario de documentación al inicio del archivo es texto libre
    // para quien edita la plantilla (menciona "<tbody>", "{{marcador}}", etc.
    // como ejemplo) — se quita ANTES de los reemplazos de abajo para que esas
    // menciones no choquen con los regex siguientes, que no distinguen HTML
    // real de HTML dentro de un comentario.
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    // El bloque FILA y las filas de ejemplo (RI-03412) son solo para revisar
    // el diseño en el navegador — se reemplaza todo el <tbody> por las filas reales.
    html = html.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>\n${rowsHtml}\n    </tbody>`);
    // Deja intacto cualquier {{marcador}} no reconocido en vez de borrarlo.
    html = html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match);

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      // printBackground: true es obligatorio o el header navy sale blanco.
      pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
    } finally {
      await browser.close();
    }

    // Mismo bucket/convención que los PDFs migrados de Monday (ver
    // server/upload.ts): raíz del bucket, `${po.id}.pdf`. upsert:true porque
    // regenerar el PDF de una OC debe reemplazar el anterior, no acumular.
    const admin = getSupabaseAdmin();
    const storagePath = `${po.id}.pdf`;
    const { error: upErr } = await admin.storage.from('purchase-orders').upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upErr) {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: `No se pudo subir el PDF a Storage: ${upErr.message}` });
    }
    const { data: pub } = admin.storage.from('purchase-orders').getPublicUrl(storagePath);
    const pdfUrl = pub.publicUrl;
    const pdfBase64 = pdfBuffer.toString('base64');

    await PurchaseOrders.update({ id: input.id, record: { pdfUrl, pdfBase64 } });

    try { await publishEvent('purchases:global', 'po.changed', { id: input.id, action: 'pdf_generated', timestamp: new Date().toISOString() }); } catch { /* silent */ }
    return { success: true, message: 'PDF generado correctamente', pdfUrl, pdfBase64 };
  },
});
