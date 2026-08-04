import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

const TEST_EMAILS = ['antonio.velasco@agcmx.com', 'sergiovelascor@yahoo.com'];

export default createEndpoint({
  authenticated: true,
  description: 'Get all team members for mentions and pickers',
  inputSchema: z.object({}),
  outputSchema: z.object({
    members: z.array(z.object({
      id: z.string(),
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      profilePhoto: z.string().optional(),
    })),
  }),
  execute: async ({ context }) => {
    const { records } = await Users.findAll({ limit: 100 });
    const isTestUser = TEST_EMAILS.includes(context.user?.email ?? '');
    return {
      members: records
        .filter(r => isTestUser || !r.hiddenFromChat)
        .map(r => ({
          id: r.id,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          profilePhoto: r.profilePhoto ?? undefined,
        })),
    };
  },
});
