import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Publish recruitment group change event via Ably so other open screens refresh their group layout',
  inputSchema: z.object({
    projectCode: z.string(),
    boardId: z.string().optional(),
    rowId: z.string().optional(),
    changeType: z.enum(['structure', 'membership']).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (input.projectCode) {
      try {
        await publishEvent(`board:${input.projectCode}`, 'recruitment.groups.changed', {
          projectCode: input.projectCode,
          boardId: input.boardId ?? '',
          rowId: input.rowId ?? '',
          changeType: input.changeType ?? 'structure',
          senderEmail: context?.user?.email ?? '',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] recruitment.groups.changed publish failed:', err);
      }
    }
    return { success: true };
  },
});
