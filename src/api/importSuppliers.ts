import { z } from 'zod';
import { createEndpoint, Suppliers } from '../../server/compat';

const supplierRowSchema = z.object({
  supplierName: z.string(),
  taxId: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  personType: z.string().optional(),
  taxRegime: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  categories: z.array(z.string()).optional(),
});

export default createEndpoint({
  description: 'Bulk import suppliers from a parsed Monday.com CSV, upsert by supplierName',
  authenticated: true,
  inputSchema: z.object({
    suppliers: z.array(supplierRowSchema),
  }),
  outputSchema: z.object({
    created: z.number(),
    total: z.number(),
  }),
  execute: async ({ input, context }) => {
    if (context.user!.role !== 'Owner' && context.user!.role !== 'Socio') {
      throw new Error('Solo los administradores pueden importar proveedores.');
    }

    const { suppliers } = input;
    if (suppliers.length === 0) return { created: 0, total: 0 };

    let created = 0;
    for (let i = 0; i < suppliers.length; i += 100) {
      const batch = suppliers.slice(i, i + 100);
      const res = await Suppliers.bulkCreate({
        records: batch,
        matchOn: ['supplierName'],
      });
      created += res.records.length;
    }

    return { created, total: suppliers.length };
  },
});
