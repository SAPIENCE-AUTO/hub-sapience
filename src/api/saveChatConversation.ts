import { z } from 'zod';
import { createEndpoint, ChatConversations } from 'zite-integrations-backend-sdk';
import { parseMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Create a DM or group chat conversation. For DMs, avoids duplicates.',
  authenticated: true,
  inputSchema: z.object({
    type: z.enum(['dm', 'group']),
    targetEmail: z.string().optional(),
    groupName: z.string().optional(),
    memberEmails: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    isExisting: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const myEmail = context.user!.email;

    if (input.type === 'dm') {
      const targetEmail = input.targetEmail;
      if (!targetEmail) throw new Error('targetEmail required for DMs');

      const { records } = await ChatConversations.findAll({
        filters: { type: 'DM' },
        limit: 500,
      });

      const existing = records.find(r => {
        const members = parseMembers(r.members);
        return members.includes(myEmail) && members.includes(targetEmail);
      });

      if (existing) return { id: existing.id, isExisting: true };

      const now = new Date().toISOString();
      const record = await ChatConversations.create({
        record: {
          conversationName: '',
          type: 'DM',
          members: JSON.stringify([myEmail, targetEmail]),
          createdBy: myEmail,
          createdAt: now,
          lastMessageAt: now,
        },
      });

      // Publish conversation.created to each member except creator
      try {
        const dmMembers = [myEmail, targetEmail];
        const payload = {
          conversationId: record.id,
          conversationType: 'DM' as const,
          conversationName: '',
          members: dmMembers,
          createdBy: myEmail,
          createdAt: now,
        };
        await Promise.allSettled(
          dmMembers
            .filter(email => email.toLowerCase() !== myEmail.toLowerCase())
            .map(email => publishEvent(safeUserChannel(email), 'conversation.created', payload))
        );
        console.log('[saveChatConversation][ably] published conversation.created', { convId: record.id, type: 'DM' });
      } catch (err) {
        console.error('[saveChatConversation][ably] failed', { error: err instanceof Error ? err.message : String(err) });
      }

      return { id: record.id, isExisting: false };
    }

    // Group
    const groupName = input.groupName ?? 'Grupo sin nombre';
    const memberEmails = input.memberEmails ?? [];
    const allMembers = [...new Set([myEmail, ...memberEmails])];
    const now = new Date().toISOString();

    const record = await ChatConversations.create({
      record: {
        conversationName: groupName,
        type: 'Group',
        members: JSON.stringify(allMembers),
        createdBy: myEmail,
        createdAt: now,
        lastMessageAt: now,
      },
    });

    // Publish conversation.created to each member except creator
    try {
      const payload = {
        conversationId: record.id,
        conversationType: 'Group' as const,
        conversationName: groupName,
        members: allMembers,
        createdBy: myEmail,
        createdAt: now,
      };
      await Promise.allSettled(
        allMembers
          .filter(email => email.toLowerCase() !== myEmail.toLowerCase())
          .map(email => publishEvent(safeUserChannel(email), 'conversation.created', payload))
      );
      console.log('[saveChatConversation][ably] published conversation.created', { convId: record.id, type: 'Group' });
    } catch (err) {
      console.error('[saveChatConversation][ably] failed', { error: err instanceof Error ? err.message : String(err) });
    }

    return { id: record.id, isExisting: false };
  },
});
