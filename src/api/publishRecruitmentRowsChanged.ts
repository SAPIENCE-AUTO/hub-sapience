import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Publish recruitment rows change event via Ably so other open screens refresh their row list',
  inputSchema: z.object({
    projectCode: z.string(),
    boardId: z.string().optional(),
    rowId: z.string().optional(),
    changeType: z.enum(['created', 'updated', 'deleted']).optional(),
    entityType: z.enum(['task', 'event', 'recruitment']).optional(),
    groupId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (input.projectCode) {
      try {
        await publishEvent(`board:${input.projectCode}`, 'recruitment.rows.changed', {
          projectCode: input.projectCode,
          boardId: input.boardId ?? '',
          rowId: input.rowId ?? '',
          changeType: input.changeType ?? 'created',
          entityType: input.entityType ?? '',
          groupId: input.groupId ?? '',
          senderEmail: context?.user?.email ?? '',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] recruitment.rows.changed publish failed:', err);
      }
    }
    return { success: true };
  },
});
