import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders, SupplierInvoices, Payments, PoAuditLog, pool } from '../../server/compat';

const poSchema = z.object({
  id: z.string(),
  poNumber: z.any().optional(),
  serviceDescription: z.string().optional(),
  totalAmount: z.number().optional(),
  currency: z.string().optional(),
  issueDate: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  projectCode: z.string().optional(),
  paymentTerms: z.string().optional(),
  pdfUrl: z.string().optional(),
  pdfBase64: z.string().optional(),
  pdfFile: z.array(z.object({ url: z.string() })).optional(),
  cancellationReason: z.string().optional(),
  // Embedded invoice (latest for this PO)
  invoiceId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceAmount: z.number().optional(),
  invoiceCurrency: z.string().optional(),
  invoiceStatus: z.string().optional(),
  invoiceUploadDate: z.string().optional(),
  invoiceReviewNotes: z.string().optional(),
  invoiceSubtotal: z.number().optional(),
  invoiceIvaRate: z.number().optional(),
  invoiceIvaAmount: z.number().optional(),
  invoiceRetencionIva: z.number().optional(),
  invoiceRetencionIsr: z.number().optional(),
});

const paymentSchema = z.object({
  id: z.string(),
  paymentId: z.any().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  status: z.string().optional(),
  method: z.string().optional(),
  poNumber: z.string().optional(),
  reference: z.string().optional(),
  attachment: z.array(z.object({ url: z.string() })).optional(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Get supplier portal data (public endpoint, validated by token + password)',
  inputSchema: z.object({ token: z.string(), password: z.string() }),
  outputSchema: z.object({
    supplier: z.object({ id: z.string(), name: z.string(), email: z.string().optional() }),
    purchaseOrders: z.array(poSchema),
    payments: z.array(paymentSchema),
  }),
  execute: async ({ input }) => {
    const supplier = await Suppliers.findOne({ filters: { accessToken: input.token } });
    if (!supplier) throw new Error('Token de acceso inválido.');
    if (supplier.portalPassword !== input.password) throw new Error('Clave de acceso incorrecta.');

    // Antes: traía TODAS las OCs del proveedor completas (con pdfBase64,
    // hasta 415 KB c/u — ver commit 0c3bfae) y filtraba las "visibles" en JS.
    // Un proveedor con muchas OCs (el mayor en producción tiene 279) podía
    // tumbar el servidor igual que pasaba en Pagos. El filtro "tiene PDF Y
    // se envió por correo" es un OR entre tres columnas (pdfUrl/pdfBase64/
    // pdfFile) que buildWhere no expresa — el motor de filtros de la capa de
    // compatibilidad solo arma ANDs de igualdad/operador simple por campo,
    // no ORs entre columnas — así que esta consulta puntual va directo a SQL
    // en vez de forzar esa capacidad a los otros 365 call sites que sí usan
    // findAll. Mismo criterio exacto que antes, solo que ahora Postgres filtra
    // antes de mandar los bytes, no Node después de recibirlos.
    const visiblePosResult = await pool.query(
      `select id, po_number as "poNumber", service_description as "serviceDescription",
              total_amount as "totalAmount", currency, issue_date as "issueDate",
              status, category, project_code as "projectCode", payment_terms as "paymentTerms",
              pdf_url as "pdfUrl", pdf_base64 as "pdfBase64", pdf_file as "pdfFile"
       from purchase_orders
       where supplier_name = $1
         and email_sent_at is not null
         and (pdf_url is not null or pdf_base64 is not null or (pdf_file is not null and jsonb_array_length(pdf_file) > 0))
       order by issue_date desc nulls last
       limit 500`,
      [supplier.supplierName],
    );
    const visiblePos = visiblePosResult.rows;
    // Esta consulta va directo a SQL (ver comentario arriba), así que no pasa
    // por stripNullScalars (server/compat/model.ts) — el normalizador que en
    // el resto de la app convierte columnas vacías de `null` a `undefined`
    // para calzar con los campos `.optional()` del outputSchema. Sin esto,
    // cualquier OC "visible" por un solo criterio del OR (ej. tiene pdfFile
    // pero pdfUrl/pdfBase64 están vacíos) manda `null` en esos otros campos y
    // truena todo el portal con STRICT_OUTPUT, no solo esa OC.
    for (const row of visiblePos) {
      for (const key in row) if (row[key] === null) row[key] = undefined;
    }

    // poMap necesita el poNumber de TODAS las OCs del proveedor (para
    // resolver el poNumber de cada pago más abajo, no solo de las
    // "visibles") — consulta liviana aparte, sin pdfBase64.
    const { records: allPosLite } = await PurchaseOrders.findAll({
      filters: { supplierName: supplier.supplierName },
      fields: ['id', 'poNumber'],
      limit: 2000,
    });

    const [invResult, paymentsResult] = await Promise.all([
      SupplierInvoices.findAll({ filters: { supplierId: supplier.id }, limit: 500 }),
      Payments.findAll({ filters: { supplierName: supplier.supplierName }, limit: 500 }),
    ]);

    // Build PO number map
    const poMap: Record<string, string> = {};
    allPosLite.forEach(p => { poMap[p.id] = String(p.poNumber ?? ''); });

    // Group invoices by poId, keep only the latest per PO
    const latestInvByPo: Record<string, typeof invResult.records[0]> = {};
    invResult.records.forEach(inv => {
      if (!inv.poId) return;
      const existing = latestInvByPo[inv.poId];
      if (!existing) {
        latestInvByPo[inv.poId] = inv;
      } else {
        const existingDate = existing.uploadDate ?? '';
        const newDate = inv.uploadDate ?? '';
        if (newDate > existingDate) latestInvByPo[inv.poId] = inv;
      }
    });

    // Fetch cancellation reasons for cancelled POs
    const cancelledPoIds = visiblePos.filter(p => p.status === 'Cancelada').map(p => p.id);
    const cancelReasonByPoId: Record<string, string> = {};
    if (cancelledPoIds.length > 0) {
      const auditResult = await PoAuditLog.findAll({ filters: { action: 'Cancelada' }, limit: 500 });
      auditResult.records.forEach(log => {
        const poId = Array.isArray(log.purchaseOrder) ? log.purchaseOrder[0] : log.purchaseOrder;
        if (poId && cancelledPoIds.includes(poId) && log.comments && !cancelReasonByPoId[poId]) {
          cancelReasonByPoId[poId] = log.comments;
        }
      });
    }

    return {
      supplier: { id: supplier.id, name: supplier.supplierName ?? '', email: supplier.email },
      purchaseOrders: visiblePos.map(p => {
        const inv = latestInvByPo[p.id];
        return {
          id: p.id,
          poNumber: p.poNumber,
          serviceDescription: p.serviceDescription,
          totalAmount: p.totalAmount,
          currency: p.currency,
          issueDate: p.issueDate,
          status: p.status,
          category: p.category,
          projectCode: p.projectCode,
          paymentTerms: p.paymentTerms,
          pdfUrl: p.pdfUrl,
          pdfBase64: p.pdfBase64,
          pdfFile: p.pdfFile,
          cancellationReason: p.status === 'Cancelada' ? cancelReasonByPoId[p.id] : undefined,
          invoiceId: inv?.id,
          invoiceNumber: inv?.invoiceNumber,
          invoiceAmount: inv?.amount,
          invoiceCurrency: inv?.currency,
          invoiceStatus: inv?.status,
          invoiceUploadDate: inv?.uploadDate,
          invoiceReviewNotes: inv?.reviewNotes,
          invoiceSubtotal: inv?.subtotal,
          invoiceIvaRate: inv?.ivaRate,
          invoiceIvaAmount: inv?.ivaAmount,
          invoiceRetencionIva: inv?.retencionIva,
          invoiceRetencionIsr: inv?.retencionIsr,
        };
      }),
      payments: paymentsResult.records.map(p => ({
        id: p.id,
        paymentId: p.paymentId,
        amount: p.amount,
        currency: p.currency,
        dueDate: p.dueDate,
        paymentDate: p.paymentDate,
        status: p.status,
        method: p.method,
        poNumber: p.poId ? poMap[p.poId] : undefined,
        reference: p.reference,
        attachment: p.attachment,
      })),
    };
  },
});
