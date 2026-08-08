import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Mark a recruitment row as NDA sent',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await RecruitmentRows.update({
      id: input.id,
      record: {
        ndaSent: true,
        ndaSentDate: new Date().toISOString(),
      },
    });
    return { success: true };
  },
});
