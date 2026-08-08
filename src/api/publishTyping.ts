import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Publish a typing indicator event via Ably (ephemeral, not stored)',
  authenticated: true,
  inputSchema: z.object({
    channel: z.string().min(1),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const userName = `${context.user!.firstName ?? ''} ${context.user!.lastName ?? ''}`.trim() || context.user!.email.split('@')[0];
    try {
      await publishEvent(`chat:${input.channel}`, 'typing', {
        channel: input.channel,
        userEmail: context.user!.email,
        userName,
        sentAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort — don't break the UI if Ably fails
    }
    return { ok: true };
  },
});
