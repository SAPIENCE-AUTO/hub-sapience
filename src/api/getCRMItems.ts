import { z } from 'zod';
import { createEndpoint, CrmItems } from '../../server/compat';

const itemSchema = z.object({
  id: z.string(),
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
});

export default createEndpoint({
  authenticated: true,
  description: 'Get CRM items filtered by project',
  inputSchema: z.object({ projectCode: z.string().optional() }),
  outputSchema: z.object({ items: z.array(itemSchema) }),
  execute: async ({ input }) => {
    const filters = input.projectCode ? { projectCode: input.projectCode } : {};
    const { records } = await CrmItems.findAll({ filters, limit: 500 });
    return { items: records };
  },
});
