import { z } from 'zod';
import { createEndpoint, Participants } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a participant',
  inputSchema: z.object({
    id: z.string().optional(),
    fullName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    idNumber: z.string().optional(),
    city: z.string().optional(),
    gender: z.string().optional(),
    age: z.number().optional(),
    totalSessions: z.number().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const { id, ...fields } = input;
    if (id) {
      await Participants.update({ id, record: fields });
      return { success: true, id };
    }
    const record = await Participants.create({ record: fields });
    return { success: true, id: record.id };
  },
});
