import { z } from 'zod';
import { createEndpoint, Participants } from 'zite-integrations-backend-sdk';

const participantSchema = z.object({
  id: z.string(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  idNumber: z.string().optional(),
  city: z.string().optional(),
  gender: z.string().optional(),
  age: z.number().optional(),
  totalSessions: z.number().optional(),
  notes: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Search participants globally',
  inputSchema: z.object({ search: z.string().optional() }),
  outputSchema: z.object({ participants: z.array(participantSchema) }),
  execute: async ({ input }) => {
    const { records } = await Participants.findAll({ limit: 500 });
    const filtered = input.search
      ? records.filter(r =>
          r.fullName?.toLowerCase().includes(input.search!.toLowerCase()) ||
          r.email?.toLowerCase().includes(input.search!.toLowerCase()) ||
          r.idNumber?.toLowerCase().includes(input.search!.toLowerCase())
        )
      : records;
    return { participants: filtered };
  },
});
