import { z } from 'zod';
import { createEndpoint, PurchaseOrders, PoLineItems, Suppliers } from '../../server/compat';

const poSchema = z.object({
  id: z.string(),
  poNumber: z.any().optional(),
  projectCode: z.string().optional(),
  supplierName: z.string().optional(),
  issueDate: z.string().optional(),
  totalAmount: z.number().optional(),
  status: z.string().optional(),
  pdfUrl: z.string().optional(),
  notes: z.string().optional(),
});

const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  poId: z.string().optional(),
  category: z.string().optional(),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  total: z.number().optional(),
  parentItemId: z.string().optional(),
});

const supplierSchema = z.object({
  id: z.string(),
  supplierName: z.string().optional(),
  identifier: z.string().optional(),
  taxId: z.string().optional(),
  taxRegime: z.string().optional(),
  personType: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  notes: z.string().optional(),
  categories: z.array(z.string()).optional(),
  accessToken: z.string().optional(),
  portalPassword: z.string().optional(),
  poCount: z.number(),
  totalSpent: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get purchase orders, line items, and suppliers with stats',
  inputSchema: z.object({ projectCode: z.string().optional() }),
  outputSchema: z.object({
    purchaseOrders: z.array(poSchema),
    lineItems: z.array(lineItemSchema),
    suppliers: z.array(supplierSchema),
  }),
  execute: async ({ input }) => {
    const poFilters = input.projectCode ? { projectCode: input.projectCode } : {};
    const [posResult, suppliersResult, itemsResult] = await Promise.all([
      PurchaseOrders.findAll({ filters: poFilters, limit: 500 }),
      Suppliers.findAll({ limit: 500 }),
      PoLineItems.findAll({ limit: 1000 }),
    ]);

    const poIds = new Set(posResult.records.map(p => p.id));
    const filteredItems = itemsResult.records.filter(item => item.poId && poIds.has(item.poId));

    const statsMap: Record<string, { poCount: number; totalSpent: number }> = {};
    posResult.records.forEach(po => {
      const name = po.supplierName ?? '';
      if (!statsMap[name]) statsMap[name] = { poCount: 0, totalSpent: 0 };
      statsMap[name].poCount += 1;
      statsMap[name].totalSpent += po.totalAmount ?? 0;
    });

    const suppliers = suppliersResult.records.map(s => {
      const stats = statsMap[s.supplierName ?? ''] ?? { poCount: 0, totalSpent: 0 };
      return {
        id: s.id,
        supplierName: s.supplierName,
        identifier: s.identifier,
        taxId: s.taxId,
        taxRegime: s.taxRegime,
        personType: s.personType,
        address: s.address,
        country: s.country,
        contactName: s.contactName,
        email: s.email,
        phone: s.phone,
        bankName: s.bankName,
        bankAccount: s.bankAccount,
        notes: s.notes,
        categories: s.categories ?? [],
        accessToken: s.accessToken,
        portalPassword: s.portalPassword,
        poCount: stats.poCount,
        totalSpent: stats.totalSpent,
      };
    });

    return {
      purchaseOrders: posResult.records,
      lineItems: filteredItems,
      suppliers,
    };
  },
});
