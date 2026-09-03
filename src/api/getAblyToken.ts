import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { createSubscribeToken, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Get a subscribe-only Ably token for realtime chat and document channels',
  authenticated: true,
  inputSchema: z.object({
    channels: z.array(z.string()).min(1).max(10),
  }),
  outputSchema: z.object({
    token: z.string().optional(),
    expires: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ input, context }) => {
    const myUserChannel = safeUserChannel(context.user!.email);

    // Filter channels: allow chat:*, doc:*, and only the caller's own user:* channel
    const allowedChannels = input.channels.filter(ch => {
      if (ch.startsWith('chat:')) return true;
      if (ch.startsWith('doc:')) return true;
      if (ch.startsWith('board:')) return true;
      if (ch.startsWith('purchases:')) return true;
      if (ch.startsWith('observation:')) return true;
      if (ch.startsWith('ejes:')) return true;
      if (ch.startsWith('user:')) return ch === myUserChannel;
      return false;
    });

    if (allowedChannels.length === 0) {
      return { error: 'No valid channels requested' };
    }

    const result = await createSubscribeToken(allowedChannels);
    if (!result) {
      return { error: 'Could not generate token' };
    }
    return { token: result.token, expires: result.expires };
  },
});
