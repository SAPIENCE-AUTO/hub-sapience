import { z } from 'zod';
import { createEndpoint, Users } from '../../server/compat';

export default createEndpoint({
  description: 'Updates the last active timestamp and active channel for the current user',
  authenticated: true,
  inputSchema: z.object({
    activeChannel: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    await Users.update({
      id: context.user!.id,
      record: {
        lastActiveAt: new Date().toISOString(),
        activeChannel: input.activeChannel ?? null,
      } as Parameters<typeof Users.update>[0]['record'],
    });
    return { success: true };
  },
});
