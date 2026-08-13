import { z } from 'zod';
import { createEndpoint, Messages } from '../../server/compat';

// Antes la búsqueda del chat era un simple .filter() en el cliente sobre los
// ~60 mensajes ya cargados (los últimos de la conversación) — no había forma
// de buscar en el historial real. Este endpoint busca en la base directamente,
// acotado a los canales que el propio cliente ya sabe que el usuario puede
// ver (mismo modelo de confianza que ya usa getUnreadCounts: la lista de
// canales la decide el front, no se revalida membresía aquí).
export default createEndpoint({
  authenticated: true,
  description: 'Search chat message history across the given channels',
  inputSchema: z.object({
    query: z.string().min(1),
    channels: z.array(z.string()),
    limit: z.number().optional(),
  }),
  // Mismo shape que getMessages — para que un resultado de búsqueda se pueda
  // renderizar con el mismo <MessageItem> sin necesitar campos por default.
  outputSchema: z.object({
    results: z.array(z.object({
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
  execute: async ({ input }) => {
    const channels = input.channels.slice(0, 500);
    const q = input.query.trim();
    if (channels.length === 0 || !q) return { results: [] };

    const { records } = await Messages.findAll({
      filters: {
        channel: { in: channels },
        content: { contains: q },
      } as any,
      sorts: [{ field: 'sentAt', direction: 'desc' }],
      limit: Math.min(input.limit ?? 100, 200),
    });

    return {
      results: records.map(r => ({
        ...r,
        pinned: r.pinned ?? false,
        parentMessageId: r.parentMessageId ?? undefined,
        reactions: r.reactions ?? undefined,
        attachments: r.attachments ?? undefined,
      })),
    };
  },
});
