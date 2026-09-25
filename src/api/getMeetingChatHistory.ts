import { z } from 'zod';
import { createEndpoint, MeetingChatMessages } from '../../server/compat';

// Puerto de getChatHistory.ts (Sharpli) — historial persistido en Postgres,
// no en el estado de React, para que sobreviva un refresh de la página.
export default createEndpoint({
  authenticated: true,
  description: 'Historial de chat de una minuta',
  inputSchema: z.object({ meetingRecordingId: z.string() }),
  outputSchema: z.object({
    messages: z.array(z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      createdAt: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await MeetingChatMessages.findAll({
      filters: { meetingRecording: input.meetingRecordingId },
      sorts: [{ field: 'createdAt', direction: 'asc' }],
      limit: 500,
    });

    return {
      messages: records.map(r => ({
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content ?? '',
        createdAt: r.createdAt,
      })),
    };
  },
});
