import { z } from 'zod';
import { createEndpoint, Messages } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  description: 'Cast or toggle a vote on a poll message',
  authenticated: true,
  inputSchema: z.object({
    messageId: z.string(),
    selectedOption: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean(), content: z.string() }),
  execute: async ({ input, context }) => {
    const msg = await Messages.findOne({ id: input.messageId });
    if (!msg) throw new Error('Message not found');

    let poll: {
      type: string;
      question: string;
      options: string[];
      votes: Record<string, string[]>;
      creatorName: string;
      creatorEmail: string;
    };

    try {
      poll = JSON.parse(msg.content ?? '');
      if (poll?.type !== 'poll') throw new Error('Not a poll');
    } catch {
      throw new Error('Invalid poll data');
    }

    const email = context.user!.email;

    // Remove user's vote from all options first
    const currentVote = Object.entries(poll.votes).find(([, users]) =>
      users.includes(email)
    )?.[0];

    const newVotes: Record<string, string[]> = {};
    for (const opt of poll.options) {
      newVotes[opt] = (poll.votes[opt] ?? []).filter(u => u !== email);
    }

    // Add vote to selected option only if it's different from current (toggle off if same)
    if (currentVote !== input.selectedOption) {
      newVotes[input.selectedOption] = [...(newVotes[input.selectedOption] ?? []), email];
    }

    const updatedContent = JSON.stringify({ ...poll, votes: newVotes });
    await Messages.update({ id: input.messageId, record: { content: updatedContent } });

    console.log('[ably][publish poll.updated]', { channel: msg.channel, messageId: input.messageId });
    try {
      await publishEvent(`chat:${msg.channel}`, 'poll.updated', {
        messageId: input.messageId,
        channel: msg.channel,
        content: updatedContent,
      });
    } catch (err) {
      console.error('[ably][poll.updated failed]', { messageId: input.messageId, message: err instanceof Error ? err.message : String(err) });
    }

    return { success: true, content: updatedContent };
  },
});
