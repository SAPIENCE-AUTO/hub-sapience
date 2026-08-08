import { z } from 'zod';
import { createEndpoint, Messages } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Toggle pin status on a message',
  authenticated: true,
  inputSchema: z.object({ messageId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), pinned: z.boolean() }),
  execute: async ({ input }) => {
    const msg = await Messages.findOne({ id: input.messageId });
    if (!msg) return { success: false, pinned: false };
    const newPinned = !msg.pinned;
    await Messages.update({ id: input.messageId, record: { pinned: newPinned } });

    console.log('[ably][publish message.pinned]', { channel: msg.channel, messageId: input.messageId, pinned: newPinned });
    try {
      await publishEvent(`chat:${msg.channel}`, 'message.pinned', {
        messageId: input.messageId,
        channel: msg.channel,
        pinned: newPinned,
      });
    } catch (err) {
      console.error('[ably][message.pinned failed]', { messageId: input.messageId, message: err instanceof Error ? err.message : String(err) });
    }

    return { success: true, pinned: newPinned };
  },
});
