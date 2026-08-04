import { z } from 'zod';
import { createEndpoint, Messages } from 'zite-integrations-backend-sdk';
import { parseReactions, serializeReactions } from '../lib/chatJson';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Toggle an emoji reaction on a message',
  authenticated: true,
  inputSchema: z.object({ messageId: z.string(), emoji: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const msg = await Messages.findOne({ id: input.messageId });
    if (!msg) return { success: false };

    const reactions = parseReactions(msg.reactions);

    const users = reactions[input.emoji] ?? [];
    const email = context.user!.email;
    reactions[input.emoji] = users.includes(email)
      ? users.filter(u => u !== email)
      : [...users, email];

    const updatedReactions = serializeReactions(reactions);
    await Messages.update({ id: input.messageId, record: { reactions: updatedReactions } });

    console.log('[ably][publish reaction.updated]', { channel: msg.channel, messageId: input.messageId });
    try {
      await publishEvent(`chat:${msg.channel}`, 'reaction.updated', {
        messageId: input.messageId,
        channel: msg.channel,
        reactions: updatedReactions,
      });
    } catch (err) {
      console.error('[ably][reaction.updated failed]', { messageId: input.messageId, message: err instanceof Error ? err.message : String(err) });
    }

    return { success: true };
  },
});
