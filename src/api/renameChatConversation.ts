import { z } from 'zod';
import { createEndpoint, ChatConversations, ZiteError } from '../../server/compat';
import { parseMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Renombra un grupo de chat. Solo quien lo creó puede renombrarlo.',
  authenticated: true,
  inputSchema: z.object({ id: z.string(), name: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const myEmail = context.user!.email;
    const name = input.name.trim();
    if (!name) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El nombre no puede estar vacío' });

    const conv = await ChatConversations.findOne({ id: input.id });
    if (!conv) throw new ZiteError({ code: 'NOT_FOUND', message: 'Grupo no encontrado' });
    if (conv.type !== 'Group') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden renombrar grupos' });
    if ((conv.createdBy ?? '').toLowerCase() !== myEmail.toLowerCase()) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo quien creó el grupo puede renombrarlo' });
    }

    await ChatConversations.update({ id: input.id, record: { conversationName: name } });

    try {
      const members = parseMembers(conv.members);
      await Promise.allSettled(
        members
          .filter(email => email.toLowerCase() !== myEmail.toLowerCase())
          .map(email => publishEvent(safeUserChannel(email), 'conversation.renamed', { conversationId: input.id, conversationName: name }))
      );
    } catch (err) {
      console.error('[renameChatConversation][ably] failed', { error: err instanceof Error ? err.message : String(err) });
    }

    return { success: true };
  },
});
