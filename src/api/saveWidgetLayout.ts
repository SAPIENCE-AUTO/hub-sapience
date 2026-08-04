import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Saves the personalized dashboard widget layout for the authenticated user',
  authenticated: true,
  inputSchema: z.object({
    layout: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    try {
      const parsed = JSON.parse(input.layout);
      if (!Array.isArray(parsed)) return { success: false };
    } catch {
      return { success: false };
    }
    await Users.update({
      id: context.user!.id,
      record: { widgetLayout: input.layout } as any,
    });
    return { success: true };
  },
});
