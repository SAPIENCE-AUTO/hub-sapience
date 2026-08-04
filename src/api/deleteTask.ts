import { z } from 'zod';
import { createEndpoint, Tasks } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a task',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    // Fetch before delete to get projectCode for Ably notification
    const task = await Tasks.findOne({ id: input.id }).catch(() => null);

    await Tasks.delete({ id: input.id });

    // Publish realtime delete event (fire-and-forget — must not fail the delete)
    if (task?.projectCode) {
      try {
        await publishEvent(`board:${task.projectCode}`, 'task.deleted', {
          id: input.id,
          projectCode: task.projectCode,
          senderEmail: context.user!.email,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] task.deleted publish failed:', err);
      }
    }

    return { success: true };
  },
});
