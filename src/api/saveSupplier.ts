import { z } from 'zod';
import { createEndpoint, Suppliers } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a supplier',
  inputSchema: z.object({
    id: z.string().optional(),
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
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const { id, ...fields } = input;
    if (id) {
      await Suppliers.update({ id, record: fields });
      return { success: true, id };
    }
    const record = await Suppliers.create({ record: fields });
    return { success: true, id: record.id };
  },
});
