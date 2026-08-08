import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PurchaseOrdersRecordType, Suppliers, BillingEntities, SupplierInvoices, Payments } from '../../server/compat';

const poSchema = z.object({
  id: z.string(),
  poNumber: z.string(),
  projectCode: z.string().optional(),
  supplierName: z.string().optional(),
  issueDate: z.string().optional(),
  totalAmount: z.number().optional(),
  status: z.string().optional(),
  enrichedStatus: z.string().optional(),
  invoiceStatus: z.string().optional(),
  paymentStatus: z.string().optional(),
  notes: z.string().optional(),
  category: z.string().optional(),
  paymentTerms: z.string().optional(),
  currency: z.string().optional(),
  createdBy: z.string().optional(),
  approvedBy: z.string().optional(),
  serviceDescription: z.string().optional(),
  billingEntity: z.string().optional(),
  pdfUrl: z.string().optional(),
  hasPdf: z.boolean().optional(),
  supplierInDb: z.boolean().optional(),
  emailSentAt: z.string().optional(),
  emailSentTo: z.string().optional(),
  orderType: z.string().optional(),
  readOnly: z.boolean().optional(),
  rejectionReason: z.string().optional(),
  origen: z.string().optional(),
});

function computeEnrichedStatus(
  baseStatus: string | undefined,
  poInvoices: { status?: string }[],
  poPayments: { status?: string }[],
): string {
  const status = baseStatus ?? 'Borrador';
  if (status === 'Borrador' || status === 'Cancelada') return status;
  if (poPayments.some(p => p.status === 'Realizado')) return 'Pagada';
  if (poPayments.some(p => p.status === 'Programado')) return 'Pago programado';
  if (poInvoices.some(i => i.status === 'Validada')) return 'Factura validada';
  if (poInvoices.some(i => i.status === 'Pendiente' || i.status === 'En revisión')) return 'Factura recibida';
  return status;
}

function getBestInvoiceStatus(poInvoices: { status?: string }[]): string | undefined {
  if (poInvoices.some(i => i.status === 'Validada')) return 'Validada';
  if (poInvoices.some(i => i.status === 'En revisión')) return 'En revisión';
  if (poInvoices.some(i => i.status === 'Pendiente')) return 'Pendiente';
  if (poInvoices.some(i => i.status === 'Rechazada')) return 'Rechazada';
  return undefined;
}

function getBestPaymentStatus(poPayments: { status?: string }[]): string | undefined {
  if (poPayments.some(p => p.status === 'Realizado')) return 'Realizado';
  if (poPayments.some(p => p.status === 'Programado')) return 'Programado';
  if (poPayments.some(p => p.status === 'Cancelado')) return 'Cancelado';
  return undefined;
}

/** Fetches ALL PurchaseOrders matching filters using paginated requests (2000/page). */
async function fetchAllPOs(filters: Record<string, unknown>): Promise<PurchaseOrdersRecordType[]> {
  const all: PurchaseOrdersRecordType[] = [];
  let offset = 0;
  while (true) {
    const result = await PurchaseOrders.findAll({ fields: ['poNumber', 'projectCode', 'supplierName', 'issueDate', 'totalAmount', 'status', 'notes', 'category', 'paymentTerms', 'currency', 'createdBy', 'approvedBy', 'serviceDescription', 'billingEntity', 'pdfUrl', 'emailSentAt', 'emailSentTo', 'tipoDeOc', 'rejectionReason', 'origen'], filters: filters as never, limit: 2000, offset });
    all.push(...result.records);
    if (!result.hasMore || result.records.length === 0) break;
    offset += result.records.length;
  }
  return all;
}

export default createEndpoint({
  authenticated: true,
  description: 'Get purchase orders filtered by user permission level, enriched with invoice and payment status',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    category: z.string().optional(),
    status: z.string().optional(),
  }),
  outputSchema: z.object({
    pos: z.array(poSchema),
    suppliers: z.array(z.object({ id: z.string(), supplierName: z.string() })),
    billingEntities: z.array(z.object({
      id: z.string(), companyName: z.string(), rfc: z.string().optional(),
      address: z.string().optional(), postalCode: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(),
    })),
    userLevel: z.string(),
    userCostCenters: z.array(z.string()),
  }),
  execute: async ({ input, context }) => {
    const purchaseLevel = context.user!.purchaseLevel ?? 'Creador';
    const costCentersArr = Array.isArray(context.user!.costCenters) ? (context.user!.costCenters as string[]) : [];

    // Run non-PO queries in parallel
    const [
      { records: suppliers },
      { records: billingEntitiesRecs },
      { records: invoices },
      { records: payments },
    ] = await Promise.all([
      Suppliers.findAll({ fields: ['supplierName'], limit: 2000 }),
      BillingEntities.findAll({ fields: ['companyName', 'rfc', 'address', 'postalCode', 'city', 'state'], limit: 100 }),
      SupplierInvoices.findAll({ fields: ['poId', 'status'], limit: 2000 }),
      Payments.findAll({ fields: ['poId', 'status'], filters: { type: 'Pago a proveedor' } as never, limit: 2000 }),
    ]);

    const baseFilters: Record<string, unknown> = {};
    if (input.projectCode) baseFilters.projectCode = input.projectCode;
    if (input.status) baseFilters.status = input.status;

    const readOnlySet = new Set<string>();
    let records: PurchaseOrdersRecordType[];

    if (purchaseLevel === 'Visor') {
      // Visor: read-only view of their cost center OCs only
      records = costCentersArr.length > 0
        ? await fetchAllPOs({ ...baseFilters, category: { in: costCentersArr } })
        : [];
      records.forEach(r => readOnlySet.add(r.id));
    } else if (purchaseLevel === 'Creador') {
      // Fetch own POs + read-only view of cost center POs
      const [ownRecords, ccRecords] = await Promise.all([
        fetchAllPOs({ ...baseFilters, createdBy: context.user!.email }),
        costCentersArr.length > 0
          ? fetchAllPOs({ ...baseFilters, category: { in: costCentersArr } })
          : Promise.resolve([] as PurchaseOrdersRecordType[]),
      ]);
      const ownIds = new Set(ownRecords.map(r => r.id));
      const combined = [...ownRecords];
      for (const r of ccRecords) {
        if (!ownIds.has(r.id)) {
          combined.push(r);
          readOnlySet.add(r.id);
        }
      }
      records = combined;
    } else {
      records = await fetchAllPOs(baseFilters);
    }

    // Apply CC filter for Aprobador
    let pos = records;
    if (purchaseLevel === 'Aprobador' && costCentersArr.length > 0) {
      pos = pos.filter(p => !p.category || costCentersArr.includes(p.category));
    }
    if (input.category) pos = pos.filter(p => p.category === input.category);

    // Build supplier name set for supplierInDb flag
    const supplierNameSet = new Set(suppliers.map(s => s.supplierName?.trim() ?? '').filter(Boolean));

    // Build invoice/payment lookup maps
    const invoicesByPo: Record<string, { status?: string }[]> = {};
    invoices.forEach(inv => { if (inv.poId) (invoicesByPo[inv.poId] ??= []).push({ status: inv.status }); });
    const paymentsByPo: Record<string, { status?: string }[]> = {};
    payments.forEach(pmt => { if (pmt.poId) (paymentsByPo[pmt.poId] ??= []).push({ status: pmt.status }); });

    return {
      pos: pos.map(p => {
        const poInvoices = invoicesByPo[p.id] ?? [];
        const poPayments = paymentsByPo[p.id] ?? [];
        return {
          id: p.id,
          poNumber: String(p.poNumber ?? ''),
          projectCode: p.projectCode,
          supplierName: p.supplierName,
          issueDate: p.issueDate,
          totalAmount: p.totalAmount,
          status: p.status,
          enrichedStatus: computeEnrichedStatus(p.status, poInvoices, poPayments),
          invoiceStatus: getBestInvoiceStatus(poInvoices),
          paymentStatus: getBestPaymentStatus(poPayments),
          notes: p.notes,
          category: p.category,
          paymentTerms: p.paymentTerms,
          currency: p.currency,
          createdBy: p.createdBy,
          approvedBy: p.approvedBy,
          serviceDescription: p.serviceDescription,
          billingEntity: p.billingEntity,
          pdfUrl: p.pdfUrl,
          hasPdf: !!p.pdfUrl,
          supplierInDb: p.supplierName ? supplierNameSet.has(p.supplierName.trim()) : false,
          emailSentAt: p.emailSentAt,
          emailSentTo: p.emailSentTo,
          orderType: p.tipoDeOc,
          readOnly: readOnlySet.has(p.id),
          rejectionReason: p.rejectionReason,
          origen: p.origen,
        };
      }),
      suppliers: suppliers.map(s => ({ id: s.id, supplierName: s.supplierName ?? '' })),
      billingEntities: billingEntitiesRecs.map(b => ({
        id: b.id, companyName: b.companyName ?? '', rfc: b.rfc,
        address: b.address, postalCode: b.postalCode, city: b.city, state: b.state,
      })),
      userLevel: purchaseLevel,
      userCostCenters: costCentersArr,
    };
  },
});
