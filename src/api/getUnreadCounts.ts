import { z } from 'zod';
import { createEndpoint, Messages } from '../../server/compat';

function stripMarkdown(text: string): string {
  if (text.startsWith('{"type":"poll"')) return '📊 Encuesta';
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#]/g, '')
    .trim();
}

export default createEndpoint({
  authenticated: true,
  description: 'Get unread message counts per channel, detect mention channels, and return last message preview per channel',
  inputSchema: z.object({
    channels: z.array(z.string()),
    lastReadTimestamps: z.record(z.string(), z.string()),
    mentionName: z.string().optional(),
  }),
  outputSchema: z.object({
    counts: z.record(z.string(), z.number()),
    mentionChannels: z.array(z.string()),
    lastMessageAt: z.record(z.string(), z.string()),
    lastMessagePreview: z.record(z.string(), z.object({ content: z.string(), senderName: z.string() })),
  }),
  execute: async ({ input, context }) => {
    const channelSet = new Set(input.channels.slice(0, 500));
    if (channelSet.size === 0) return { counts: {}, mentionChannels: [], lastMessageAt: {}, lastMessagePreview: {} };

    // Always look back at least 7 days so lastMessagePreview is populated for
    // all channels with recent activity — even channels that have been fully read.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fallback = sevenDaysAgo;
    const timestamps = [...channelSet].map(ch => input.lastReadTimestamps[ch as string] ?? fallback);
    const minTimestamp = timestamps.reduce((min, t) => (t < min ? t : min), timestamps[0]);
    // Enforce a floor of 7 days so we never miss previews for read-but-old channels
    const effectiveMin = minTimestamp < sevenDaysAgo ? minTimestamp : sevenDaysAgo;

    const { records } = await Messages.findAll({
      // Antes solo filtraba por fecha y escaneaba TODOS los canales de la
      // organización, filtrando por canal en JS después de traer hasta 2000
      // filas — el costo escalaba con el volumen total, no con los canales
      // que de verdad le interesan a quien llama. También traía "sort"
      // (typo — la interfaz real es "sorts"), silenciado por el `as any` de
      // abajo, así que nunca ordenaba nada en SQL.
      filters: { sentAt: { gt: effectiveMin }, channel: { in: [...channelSet] } } as any,
      limit: 2000,
      sorts: [{ field: 'sentAt', direction: 'desc' }],
      fields: ['channel', 'senderEmail', 'senderName', 'parentMessageId', 'sentAt', 'content'],
    } as any);

    const counts: Record<string, number> = {};
    const lastMessageAt: Record<string, string> = {};
    const lastMessagePreview: Record<string, { content: string; senderName: string }> = {};
    for (const channel of channelSet) counts[channel as string] = 0;
    const mentionSet = new Set<string>();
    const nameLower = input.mentionName?.trim().toLowerCase();
    const myEmailLower = context.user!.email.toLowerCase();

    for (const m of records) {
      if (!m.channel || !channelSet.has(m.channel)) continue;
      if (m.parentMessageId) continue;
      if (!m.sentAt) continue;

      // Track latest message timestamp and preview for ALL messages (including own)
      if (!lastMessageAt[m.channel] || m.sentAt > lastMessageAt[m.channel]) {
        lastMessageAt[m.channel] = m.sentAt;
        const rawContent = m.content ?? '';
        const cleanContent = stripMarkdown(rawContent).slice(0, 80);
        lastMessagePreview[m.channel] = {
          content: cleanContent || '📎 Archivo',
          senderName: m.senderName ?? m.senderEmail?.split('@')[0] ?? 'Desconocido',
        };
      }

      // Never count the user's own messages as unread
      if (m.senderEmail && m.senderEmail.toLowerCase() === myEmailLower) continue;

      const lastRead = input.lastReadTimestamps[m.channel];
      const isUnread = !lastRead || new Date(m.sentAt) > new Date(lastRead);
      if (!isUnread) continue;

      counts[m.channel] = (counts[m.channel] ?? 0) + 1;

      if (nameLower && (m.content ?? '').toLowerCase().includes(`@${nameLower}`)) {
        mentionSet.add(m.channel);
      }
    }

    return { counts, mentionChannels: [...mentionSet], lastMessageAt, lastMessagePreview };
  },
});
