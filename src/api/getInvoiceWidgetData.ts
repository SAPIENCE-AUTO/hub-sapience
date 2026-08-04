import { z } from 'zod';
import { createEndpoint, SupplierInvoices } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Returns unpaid supplier invoice count and last 10 invoices for the dashboard widget',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    unpaidCount: z.number(),
    invoices: z.array(z.object({
      id: z.string(),
      invoiceNumber: z.string().optional(),
      supplierName: z.string().optional(),
      amount: z.number().optional(),
      currency: z.string().optional(),
      status: z.string().optional(),
      uploadDate: z.string().optional(),
      projectCode: z.string().optional(),
    })),
  }),
  execute: async () => {
    const { records } = await SupplierInvoices.findAll({
      filters: { status: { not: 'Validada' } },
      limit: 500,
    });

    // Sort by uploadDate desc
    const sorted = records
      .filter(r => r.uploadDate)
      .sort((a, b) => new Date(b.uploadDate!).getTime() - new Date(a.uploadDate!).getTime());

    const noDateRecords = records.filter(r => !r.uploadDate);
    const allSorted = [...sorted, ...noDateRecords];

    return {
      unpaidCount: allSorted.length,
      invoices: allSorted.slice(0, 10).map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        supplierName: r.supplierName,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        uploadDate: r.uploadDate,
        projectCode: r.projectCode,
      })),
    };
  },
});
