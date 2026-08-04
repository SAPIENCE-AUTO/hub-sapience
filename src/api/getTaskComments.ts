import { z } from 'zod';
import { createEndpoint, TaskComments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get chat comments/mentions for a specific task',
  authenticated: true,
  inputSchema: z.object({
    taskId: z.string(),
  }),
  outputSchema: z.object({
    comments: z.array(z.object({
      id: z.string(),
      messageId: z.string().optional(),
      taskName: z.string().optional(),
      channel: z.string().optional(),
      senderName: z.string().optional(),
      senderEmail: z.string().optional(),
      content: z.string().optional(),
      sentAt: z.string().optional(),
      isThreadReply: z.boolean().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await TaskComments.findAll({
      filters: { taskId: input.taskId },
      limit: 100,
      fields: ['taskId', 'messageId', 'taskName', 'channel', 'senderName', 'senderEmail', 'content', 'sentAt', 'isThreadReply'],
    });

    // Sort by sentAt ascending
    const sorted = records
      .filter(r => r.sentAt)
      .sort((a, b) => (a.sentAt! < b.sentAt! ? -1 : 1));

    return {
      comments: sorted.map(r => ({
        id: r.id,
        messageId: r.messageId ?? undefined,
        taskName: r.taskName ?? undefined,
        channel: r.channel ?? undefined,
        senderName: r.senderName ?? undefined,
        senderEmail: r.senderEmail ?? undefined,
        content: r.content ?? undefined,
        sentAt: r.sentAt ?? undefined,
        isThreadReply: r.isThreadReply ?? undefined,
      })),
    };
  },
});
