import { z } from 'zod';
import { createEndpoint, RubroAssignments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Assign or unassign a user to a quotation rubro. Upserts by rubro name.',
  inputSchema: z.object({
    id: z.string().optional(),
    rubro: z.string(),
    assignedUserId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const assignedUser = input.assignedUserId ? [input.assignedUserId] : null;

    // Update existing record if ID is provided
    if (input.id) {
      const result = await RubroAssignments.update({
        id: input.id,
        record: { assignedUser: assignedUser as any },
      });
      return { success: true, id: result.id };
    }

    // Find existing by rubro name (upsert)
    const { records } = await RubroAssignments.findAll({
      filters: { rubro: input.rubro },
      limit: 5,
    });
    const existing = records[0];

    if (existing) {
      const result = await RubroAssignments.update({
        id: existing.id,
        record: { assignedUser: assignedUser as any },
      });
      return { success: true, id: result.id };
    }

    // Create new record
    const result = await RubroAssignments.create({
      record: {
        rubro: input.rubro,
        assignedUser: assignedUser as any,
      },
    });
    return { success: true, id: result.id };
  },
});
