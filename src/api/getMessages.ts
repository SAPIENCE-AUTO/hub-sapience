import { z } from 'zod';
import { createEndpoint, Messages, ChatConversations } from '../../server/compat';
import { parseMembers } from '../lib/chatJson';

const sanitize = (r: Awaited<ReturnType<typeof Messages.findAll>>['records'][0]) => ({
  ...r,
  pinned: r.pinned ?? false,
  parentMessageId: r.parentMessageId ?? undefined,
  reactions: r.reactions ?? undefined,
  attachments: r.attachments ?? undefined,
});

// Ordena ascendente (más viejo primero) — mismo criterio que antes se hacía
// solo en JS después de un LIMIT sin ORDER BY, lo cual no garantizaba nada:
// Postgres puede devolver las filas en cualquier orden sin ORDER BY explícito.
// Se deja como red de seguridad idempotente aunque ahora sorts ya ordena en SQL.
const byDateAsc = (a: { sentAt?: string }, b: { sentAt?: string }) =>
  new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime();

export default createEndpoint({
  description: 'Get messages for a channel (including replies), with pagination for older history',
  authenticated: true,
  inputSchema: z.object({
    channel: z.string(),
    limit: z.number().optional(),
    since: z.string().optional(),
    /** Cursor: trae los mensajes más viejos que esta fecha (para "cargar mensajes anteriores"). */
    before: z.string().optional(),
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
    /** Solo tiene sentido en el modo `before`: si hay historial más viejo aún por cargar. */
    hasMoreOlder: z.boolean().optional(),
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

    // Incremental fetch: only messages newer than `since` (realtime polling fallback)
    if (input.since) {
      const { records } = await Messages.findAll({
        filters: { channel: input.channel, sentAt: { gt: new Date(input.since) } },
        sorts: [{ field: 'sentAt', direction: 'asc' }],
        limit: 2000,
      });
      return { messages: records.map(sanitize).sort(byDateAsc) };
    }

    const limit = input.limit ?? 60;

    // "Cargar mensajes anteriores": trae el bloque justo antes del más viejo
    // ya cargado en el cliente. Se pide sorts desc + limit para que Postgres
    // tome las N filas más recientes DE ESE LADO del cursor directo del
    // índice, en vez de traer todo el historial y recortar en JS.
    if (input.before) {
      const { records, hasMore } = await Messages.findAll({
        filters: { channel: input.channel, sentAt: { lt: new Date(input.before) } },
        sorts: [{ field: 'sentAt', direction: 'desc' }],
        limit,
      });
      return { messages: records.map(sanitize).sort(byDateAsc), hasMoreOlder: hasMore };
    }

    // Carga inicial: las últimas `limit` (mismo truco — desc + limit en SQL,
    // ya no hace falta traer hasta 2000 filas para recortar en JS).
    const { records, hasMore } = await Messages.findAll({
      filters: { channel: input.channel },
      sorts: [{ field: 'sentAt', direction: 'desc' }],
      limit,
    });

    return { messages: records.map(sanitize).sort(byDateAsc), hasMoreOlder: hasMore };
  },
});
