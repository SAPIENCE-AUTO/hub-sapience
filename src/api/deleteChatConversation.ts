import { z } from 'zod';
import { createEndpoint, pool, ChatConversations, ZiteError } from '../../server/compat';
import { parseMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Elimina (soft-delete) un grupo de chat. Solo quien lo creó puede borrarlo.',
  authenticated: true,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const myEmail = context.user!.email;

    const conv = await ChatConversations.findOne({ id: input.id });
    if (!conv) throw new ZiteError({ code: 'NOT_FOUND', message: 'Grupo no encontrado' });
    if (conv.type !== 'Group') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden eliminar grupos' });
    if ((conv.createdBy ?? '').toLowerCase() !== myEmail.toLowerCase()) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo quien creó el grupo puede eliminarlo' });
    }

    // deleted_at no está en ChatConversations.fields (schema-map.ts es
    // generado por generate.py, ver server/scripts/add-chat-conversations-
    // deleted-at-column.ts) — se escribe aparte con pool.query, igual que
    // home_page en server/auth.ts.
    await pool.query(`update chat_conversations set deleted_at = now() where id = $1`, [input.id]);

    // Best-effort: avisa a los demás miembros en tiempo real para que el
    // grupo desaparezca de su sidebar sin que tengan que recargar.
    try {
      const members = parseMembers(conv.members);
      await Promise.allSettled(
        members
          .filter(email => email.toLowerCase() !== myEmail.toLowerCase())
          .map(email => publishEvent(safeUserChannel(email), 'conversation.deleted', { conversationId: input.id }))
      );
    } catch (err) {
      console.error('[deleteChatConversation][ably] failed', { error: err instanceof Error ? err.message : String(err) });
    }

    return { success: true };
  },
});
