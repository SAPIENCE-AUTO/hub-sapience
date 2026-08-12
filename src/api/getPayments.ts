import { z } from 'zod';
import { createEndpoint, Payments, PurchaseOrders, Suppliers, BillingEntities } from '../../server/compat';

const paymentSchema = z.object({
  id: z.string(),
  paymentId: z.any().optional(),
  poId: z.string().optional(),
  poNumber: z.string().optional(),
  projectCode: z.string().optional(),
  supplierName: z.string().optional(),
  supplierEmail: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  paymentDate: z.string().optional(),
  dueDate: z.string().optional(),
  method: z.string().optional(),
  reference: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  supplierInvoiceNumber: z.string().optional(),
  destinationAccount: z.string().optional(),
  sourceCompany: z.string().optional(),
  sourceBank: z.string().optional(),
  sourceAccount: z.string().optional(),
  attachment: z.array(z.object({ url: z.string() })).optional(),
  poTotalAmount: z.number().optional(),
  poPendingAmount: z.number().optional(),
});

const poOptionSchema = z.object({
  id: z.string(),
  poNumber: z.string(),
  supplierName: z.string(),
  projectCode: z.string(),
  totalAmount: z.number(),
  pendingAmount: z.number(),
  billingEntity: z.string().optional(),
});

const billingEntityOptionSchema = z.object({
  id: z.string(),
  companyName: z.string(),
});

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export default createEndpoint({
  authenticated: true,
  description: 'Get payments to suppliers with enriched PO data and billing entity options',
  inputSchema: z.object({
    status: z.string().optional(),
    supplierName: z.string().optional(),
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({
    payments: z.array(paymentSchema),
    poOptions: z.array(poOptionSchema),
    billingEntityOptions: z.array(billingEntityOptionSchema),
  }),
  execute: async ({ input }) => {
    // Step 1: Fetch payments
    const paymentsResult = await Payments.findAll({ filters: { type: 'Pago a proveedor' }, limit: 500 });

    // Small delay between DB calls to avoid rate limiting
    await delay(150);

    // Step 2: Fetch referenced POs (sequential batches with delays)
    // fields explícito: sin esto, cada fila trae pdfBase64 completo (68 KB en
    // promedio, hasta 415 KB) — medido en producción: un solo lote de 100 OCs
    // así tardó 37s y sumó ~35 MB de heap. Ninguno de los dos usos de
    // PurchaseOrders en este archivo (poMap ni poOptions) lee pdfBase64/pdfFile.
    const PO_FIELDS = ['poNumber', 'supplierName', 'projectCode', 'totalAmount', 'billingEntity'];
    const uniquePoIds = [...new Set(paymentsResult.records.map(p => p.poId).filter(Boolean))] as string[];
    let referencedPOs: Awaited<ReturnType<typeof PurchaseOrders.findAll>>['records'] = [];
    if (uniquePoIds.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < uniquePoIds.length; i += BATCH) {
        if (i > 0) await delay(200);
        const batch = uniquePoIds.slice(i, i + BATCH);
        const result = await PurchaseOrders.findAll({
          filters: { id: { in: batch } },
          fields: PO_FIELDS,
          limit: BATCH,
        });
        referencedPOs = [...referencedPOs, ...result.records];
      }
    }

    await delay(150);

    // Step 3: Fetch suppliers
    const suppliersResult = await Suppliers.findAll({ limit: 500 });

    await delay(150);

    // Step 4: Fetch billing entities
    const billingEntitiesResult = await BillingEntities.findAll({ limit: 200 });

    await delay(150);

    // Step 5: Fetch ALL approved POs for the form dropdown.
    // Antes: limit: 500 sin paginar — con 1,154 OCs aprobadas reales en
    // producción, eso truncaba silenciosamente más de la mitad del
    // desplegable (cuáles 500 quedaban fuera dependía del orden de escaneo
    // de Postgres, no de nada elegido). Ahora pagina hasta traerlas todas;
    // como ya no arrastra pdfBase64 (ver PO_FIELDS arriba), traer el total
    // real es barato.
    let approvedPos: Awaited<ReturnType<typeof PurchaseOrders.findAll>>['records'] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await PurchaseOrders.findAll({
          filters: { status: { in: ['Aprobada', 'Enviada a aprobación'] } },
          fields: PO_FIELDS,
          limit: 2000,
          offset,
        });
        approvedPos = [...approvedPos, ...page.records];
        hasMore = page.hasMore;
        offset += page.records.length;
      }
    }

    // Build supplier email map
    const supplierEmailMap: Record<string, string> = {};
    suppliersResult.records.forEach(s => {
      if (s.supplierName && s.email) supplierEmailMap[s.supplierName] = s.email;
    });

    // Build PO lookup map
    const poMap: Record<string, { poNumber: string; supplierName: string; projectCode: string; totalAmount: number; billingEntity?: string }> = {};
    referencedPOs.forEach(po => {
      poMap[po.id] = {
        poNumber: String(po.poNumber ?? ''),
        supplierName: po.supplierName ?? '',
        projectCode: po.projectCode ?? '',
        totalAmount: po.totalAmount ?? 0,
        billingEntity: po.billingEntity ?? undefined,
      };
    });

    // Calculate paid amount per PO
    const paidPerPo: Record<string, number> = {};
    paymentsResult.records.forEach(p => {
      if (p.poId && p.status === 'Realizado') {
        paidPerPo[p.poId] = (paidPerPo[p.poId] ?? 0) + (p.amount ?? 0);
      }
    });

    // Enrich payments
    let payments = paymentsResult.records.map(p => {
      const po = p.poId ? poMap[p.poId] : undefined;
      const poTotal = po?.totalAmount ?? 0;
      const paid = p.poId ? (paidPerPo[p.poId] ?? 0) : 0;
      const resolvedSupplierName = p.supplierName ?? po?.supplierName;
      return {
        id: p.id,
        paymentId: p.paymentId,
        poId: p.poId,
        poNumber: po?.poNumber,
        projectCode: p.projectCode ?? po?.projectCode,
        supplierName: resolvedSupplierName,
        supplierEmail: resolvedSupplierName ? supplierEmailMap[resolvedSupplierName] : undefined,
        amount: p.amount,
        currency: p.currency,
        paymentDate: p.paymentDate,
        dueDate: p.dueDate,
        method: p.method,
        reference: p.reference,
        status: p.status,
        notes: p.notes,
        supplierInvoiceNumber: p.supplierInvoiceNumber,
        destinationAccount: p.destinationAccount,
        sourceCompany: p.sourceCompany ?? (p.poId ? poMap[p.poId]?.billingEntity : undefined),
        sourceBank: p.sourceBank,
        sourceAccount: p.sourceAccount,
        attachment: p.attachment,
        poTotalAmount: poTotal,
        poPendingAmount: Math.max(0, poTotal - paid),
      };
    });

    // Apply filters
    if (input.status) payments = payments.filter(p => p.status === input.status);
    if (input.supplierName) payments = payments.filter(p => p.supplierName?.toLowerCase().includes(input.supplierName!.toLowerCase()));
    if (input.projectCode) payments = payments.filter(p => p.projectCode === input.projectCode);

    // Build PO options
    const poOptions = approvedPos.map(po => ({
      id: po.id,
      poNumber: String(po.poNumber ?? ''),
      supplierName: po.supplierName ?? '',
      projectCode: po.projectCode ?? '',
      totalAmount: po.totalAmount ?? 0,
      pendingAmount: Math.max(0, (po.totalAmount ?? 0) - (paidPerPo[po.id] ?? 0)),
      billingEntity: po.billingEntity ?? undefined,
    }));

    // Build billing entity options
    const billingEntityOptions = billingEntitiesResult.records.map(b => ({
      id: b.id,
      companyName: b.companyName ?? '',
    })).filter(b => b.companyName);

    return { payments, poOptions, billingEntityOptions };
  },
});
