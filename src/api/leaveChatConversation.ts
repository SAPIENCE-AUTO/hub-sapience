import { z } from 'zod';
import { createEndpoint, ChatConversations, ZiteError } from '../../server/compat';
import { parseMembers, serializeMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Sale de un grupo de chat. Quien lo creó no puede salir — debe eliminarlo.',
  authenticated: true,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const myEmail = context.user!.email;

    const conv = await ChatConversations.findOne({ id: input.id });
    if (!conv) throw new ZiteError({ code: 'NOT_FOUND', message: 'Grupo no encontrado' });
    if (conv.type !== 'Group') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se puede salir de grupos' });
    if ((conv.createdBy ?? '').toLowerCase() === myEmail.toLowerCase()) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Quien creó el grupo debe eliminarlo en vez de salir' });
    }

    const members = parseMembers(conv.members);
    if (!members.some(e => e.toLowerCase() === myEmail.toLowerCase())) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No eres miembro de este grupo' });
    }

    const newMembers = members.filter(e => e.toLowerCase() !== myEmail.toLowerCase());
    await ChatConversations.update({ id: input.id, record: { members: serializeMembers(newMembers) } });

    try {
      await Promise.allSettled(
        newMembers.map(email => publishEvent(safeUserChannel(email), 'conversation.membersUpdated', { conversationId: input.id, members: newMembers }))
      );
    } catch (err) {
      console.error('[leaveChatConversation][ably] failed', { error: err instanceof Error ? err.message : String(err) });
    }

    return { success: true };
  },
});
