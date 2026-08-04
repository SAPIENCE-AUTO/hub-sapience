import { z } from 'zod';
import { createEndpoint, PoAuditLog } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get audit log entries for a purchase order',
  inputSchema: z.object({ poId: z.string() }),
  outputSchema: z.object({
    entries: z.array(z.object({
      id: z.string(),
      timestamp: z.string().optional(),
      action: z.string().optional(),
      userEmail: z.string().optional(),
      userName: z.string().optional(),
      comments: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const { records } = await PoAuditLog.findAll({
      filters: { purchaseOrder: input.poId } as never,
      limit: 200,
    });

    const sorted = [...records].sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });

    return {
      entries: sorted.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        action: r.action,
        userEmail: r.userEmail,
        userName: r.userName,
        comments: r.comments,
      })),
    };
  },
});
