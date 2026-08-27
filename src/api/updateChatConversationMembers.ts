import { z } from 'zod';
import { createEndpoint, ChatConversations, ZiteError } from '../../server/compat';
import { parseMembers, serializeMembers } from '../lib/chatJson';
import { publishEvent, safeUserChannel } from '../lib/ably';

export default createEndpoint({
  description: 'Reemplaza la lista de miembros de un grupo de chat. Solo quien lo creó puede editarla.',
  authenticated: true,
  inputSchema: z.object({ id: z.string(), memberEmails: z.array(z.string()) }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const myEmail = context.user!.email;

    const conv = await ChatConversations.findOne({ id: input.id });
    if (!conv) throw new ZiteError({ code: 'NOT_FOUND', message: 'Grupo no encontrado' });
    if (conv.type !== 'Group') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se pueden editar miembros de grupos' });
    if ((conv.createdBy ?? '').toLowerCase() !== myEmail.toLowerCase()) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo quien creó el grupo puede editar sus miembros' });
    }

    const createdByEmail = conv.createdBy ?? myEmail;
    const newMembers = [...new Set([createdByEmail, ...input.memberEmails])];
    if (newMembers.length < 2) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'El grupo necesita al menos un miembro además de ti' });
    }

    const oldMembers = parseMembers(conv.members);
    await ChatConversations.update({ id: input.id, record: { members: serializeMembers(newMembers) } });

    try {
      // Avisa tanto a los que ya estaban como a los recién agregados/quitados —
      // los quitados necesitan el evento para desaparecer el grupo de su sidebar.
      const notifyEmails = [...new Set([...oldMembers, ...newMembers])];
      await Promise.allSettled(
        notifyEmails
          .filter(email => email.toLowerCase() !== myEmail.toLowerCase())
          .map(email => publishEvent(safeUserChannel(email), 'conversation.membersUpdated', { conversationId: input.id, members: newMembers }))
      );
    } catch (err) {
      console.error('[updateChatConversationMembers][ably] failed', { error: err instanceof Error ? err.message : String(err) });
    }

    return { success: true };
  },
});
