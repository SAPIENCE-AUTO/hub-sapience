import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Upload profile photo URL and update the current user record',
  inputSchema: z.object({
    photoUrl: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    photoUrl: z.string(),
  }),
  execute: async ({ input, context }) => {
    await Users.update({
      id: context.user!.id,
      record: { profilePhoto: input.photoUrl },
    });
    return { success: true, photoUrl: input.photoUrl };
  },
});
