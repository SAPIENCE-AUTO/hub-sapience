import { z } from 'zod';
import { createEndpoint, ChatConversations, pool } from '../../server/compat';
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
      createdBy: z.string().optional(),
    })),
  }),
  execute: async ({ context }) => {
    const myEmail = context.user!.email;

    const { records: allRecords } = await ChatConversations.findAll({
      filters: { members: { contains: myEmail } },
      limit: 500,
    });

    // deleted_at no está en ChatConversations.fields (generado, ver
    // server/scripts/add-chat-conversations-deleted-at-column.ts) —
    // se resuelve aparte con una consulta cruda, igual que en
    // deleteChatConversation.ts.
    const { rows: deletedRows } = await pool.query<{ id: string }>(
      `select id from chat_conversations where deleted_at is not null`,
    );
    const deletedIds = new Set(deletedRows.map(r => r.id));
    const records = allRecords.filter(r => !deletedIds.has(r.id));

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
        createdBy: r.createdBy ?? undefined,
      }))
      .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());

    return { dms, groups };
  },
});
