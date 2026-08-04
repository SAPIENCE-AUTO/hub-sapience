import { z } from 'zod';
import { createEndpoint, Messages, ChatConversations } from 'zite-integrations-backend-sdk';
import { parseMembers } from '../lib/chatJson';

const sanitize = (r: Awaited<ReturnType<typeof Messages.findAll>>['records'][0]) => ({
  ...r,
  pinned: r.pinned ?? false,
  parentMessageId: r.parentMessageId ?? undefined,
  reactions: r.reactions ?? undefined,
  attachments: r.attachments ?? undefined,
});

export default createEndpoint({
  description: 'Get messages for a channel (including replies)',
  authenticated: true,
  inputSchema: z.object({
    channel: z.string(),
    limit: z.number().optional(),
    since: z.string().optional(),
  }),
  outputSchema: z.object({
    messages: z.array(z.object({
      id: z.string(),
      messageId: z.any().optional(),
      channel: z.string().optional(),
      senderName: z.string().optional(),
      senderEmail: z.string().optional(),
      content: z.string().optional(),
      sentAt: z.string().optional(),
      parentMessageId: z.string().optional(),
      reactions: z.string().optional(),
      pinned: z.boolean().optional(),
      attachments: z.string().optional(),
    })),
  }),
  execute: async ({ input, context }) => {
    // Check if this channel is a DM/group conversation (not "general" or a project code)
    if (input.channel !== 'general') {
      try {
        const conv = await ChatConversations.findOne({ id: input.channel });
        if (conv) {
          // It's a conversation record — verify the user is a member
          const members: string[] = parseMembers(conv.members);
          if (!members.includes(context.user!.email)) {
            return { messages: [] };
          }
        }
        // If conv is undefined → not found, treat as regular project channel, allow access
      } catch {
        // Error looking up → treat as regular project channel, allow access
      }
    }

    // Incremental fetch: only messages newer than `since`
    if (input.since) {
      const { records } = await Messages.findAll({
        filters: { channel: input.channel, sentAt: { gt: new Date(input.since) } },
      });
      return {
        messages: records
          .map(sanitize)
          .sort((a, b) =>
            new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime()
          ),
      };
    }

    // Full fetch (initial load): get all messages, sort ascending, keep only the LAST N
    // This ensures we always show the most recent messages, not the oldest ones.
    const limit = input.limit ?? 60;
    const { records } = await Messages.findAll({
      filters: { channel: input.channel },
      limit: 2000,
    });

    const sorted = records
      .map(sanitize)
      .sort((a, b) =>
        new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime()
      );

    // Slice to keep only the most recent `limit` messages
    const recent = sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;

    return { messages: recent };
  },
});
