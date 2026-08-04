import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Publish ephemeral document lock events to Ably realtime channel',
  authenticated: true,
  inputSchema: z.object({
    docId: z.string(),
    eventType: z.enum(['block.lock', 'block.unlock', 'block.lock_heartbeat']),
    blockId: z.string(),
    lockId: z.string(),
    expiresAt: z.number().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ input, context }) => {
    const { docId, eventType, blockId, lockId, expiresAt } = input;
    const userName =
      [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') ||
      context.user!.email;

    const data = {
      docId,
      blockId,
      lockId,
      userId: context.user!.id,
      userEmail: context.user!.email,
      userName,
      expiresAt: expiresAt ?? Date.now() + 15000,
    };

    try {
      await publishEvent(`doc:${docId}`, eventType, data);
      return { success: true };
    } catch (err) {
      console.error('[publishDocEvent] failed:', (err as Error).message);
      return { success: false, error: 'publish failed' };
    }
  },
});
