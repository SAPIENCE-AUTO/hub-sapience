import { z } from 'zod';
import { createEndpoint, ChatConversations } from 'zite-integrations-backend-sdk';
import { parseMembers } from '../lib/chatJson';

export default createEndpoint({
  description: 'Get all DM and group conversations for the current user',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    dms: z.array(z.object({
      id: z.string(),
      members: z.array(z.string()),
      lastMessageAt: z.string().optional(),
    })),
    groups: z.array(z.object({
      id: z.string(),
      name: z.string(),
      members: z.array(z.string()),
      lastMessageAt: z.string().optional(),
    })),
  }),
  execute: async ({ context }) => {
    const myEmail = context.user!.email;

    const { records } = await ChatConversations.findAll({
      filters: { members: { contains: myEmail } },
      limit: 500,
    });

    const dms = records
      .filter(r => r.type === 'DM')
      .map(r => ({
        id: r.id,
        members: parseMembers(r.members),
        lastMessageAt: r.lastMessageAt ?? undefined,
      }))
      .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());

    const groups = records
      .filter(r => r.type === 'Group')
      .map(r => ({
        id: r.id,
        name: r.conversationName ?? 'Grupo',
        members: parseMembers(r.members),
        lastMessageAt: r.lastMessageAt ?? undefined,
      }))
      .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());

    return { dms, groups };
  },
});
