import { z } from 'zod';
import { createEndpoint, CrmItems } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a CRM item',
  inputSchema: z.object({
    id: z.string().optional(),
    itemName: z.string().optional(),
    projectCode: z.string().optional(),
    client: z.string().optional(),
    status: z.string().optional(),
    proposalDate: z.string().optional(),
    contractDate: z.string().optional(),
    budget: z.number().optional(),
    revenue: z.number().optional(),
    assignedTo: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const { id, ...fields } = input;
    if (id) {
      await CrmItems.update({ id, record: fields });
      return { success: true, id };
    }
    const record = await CrmItems.create({ record: fields });
    return { success: true, id: record.id };
  },
});
