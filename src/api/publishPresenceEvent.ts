import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Publishes a user presence event to the project Ably channel',
  authenticated: true,
  inputSchema: z.object({
    projectCode: z.string(),
    pageName: z.string(),
    activeChannel: z.string(),
    name: z.string().optional(),
    profilePhoto: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    try {
      await publishEvent(`board:${input.projectCode}`, 'user.presence', {
        email: context.user!.email,
        name: input.name,
        profilePhoto: input.profilePhoto,
        projectCode: input.projectCode,
        pageName: input.pageName,
        activeChannel: input.activeChannel,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Silent — never block UI for presence
    }
    return { success: true };
  },
});
