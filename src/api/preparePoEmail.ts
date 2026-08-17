import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createEndpoint, PurchaseOrders, Suppliers, ZiteError } from '../../server/compat';
import { fmtCurrency } from '../lib/format';

const TEMPLATE_PATH = join(import.meta.dirname, '../../server/templates/correo-orden-compra.html');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    // `||`, no `??` — contactName puede venir guardado como '' (no null) para
    // proveedores sin persona de contacto capturada; con `??` ese '' pasaba
    // tal cual y el saludo del correo salía "Estimado/a :" vacío.
    const contactName = supplier?.contactName || supplierName;
    const sendAsEmail = process.env.ZITE_OUTLOOK_SEND_AS_EMAIL?.trim() || undefined;
    const senderName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    const senderEmail = sendAsEmail || context.user!.email;

    // Los tres bloques <!-- SI ... --> de la plantilla, en el mismo orden en
    // que aparecen en el archivo: condiciones de pago, descripción del
    // servicio, portal de proveedores. Se quitan (junto con su contenido)
    // cuando el dato correspondiente viene vacío.
    const sectionConditions = [!!po.paymentTerms, !!po.serviceDescription, !!portalUrl];

    let html = readFileSync(TEMPLATE_PATH, 'utf-8');
    // El comentario de documentación al inicio del archivo es solo para quien
    // edita la plantilla — se quita antes de procesar los <!-- SI --> reales,
    // que sí importan aquí (mismo problema que ya resolvió generatePoPdf.ts
    // para su propio comentario inicial). El comentario de documentación
    // menciona "<!-- SI ... -->" como ejemplo de texto dentro de su propia
    // prosa — un `-->` no anclado a inicio de línea cortaría ahí en vez de en
    // el cierre real del comentario (línea suelta con solo "-->"), así que el
    // regex exige que el cierre esté solo en su propia línea.
    html = html.replace(/^<!--[\s\S]*?^-->\s*/m, '');
    let sectionIndex = 0;
    html = html.replace(/<!--\s*SI[^>]*-->([\s\S]*?)<!--\s*\/SI[^>]*-->/g, (_match, inner: string) =>
      sectionConditions[sectionIndex++] ? inner : ''
    );

    const replacements: Record<string, string> = {
      contactName: escapeHtml(contactName),
      poNumber: escapeHtml(String(po.poNumber ?? '')),
      projectCode: escapeHtml(po.projectCode ?? ''),
      totalAmount: escapeHtml(fmtCurrency(po.totalAmount, po.currency ?? 'MXN')),
      moneda: escapeHtml(po.currency ?? 'MXN'),
      paymentTerms: escapeHtml(po.paymentTerms ?? ''),
      serviceDescription: escapeHtml(po.serviceDescription ?? ''),
      portalUrl: escapeHtml(portalUrl),
      portalPassword: escapeHtml(password),
    };
    // Deja intacto cualquier {{marcador}} no reconocido en vez de borrarlo.
    html = html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match);

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
      body: html,
      hasPdf: !!po.pdfUrl || !!po.pdfBase64,
    };
  },
});
