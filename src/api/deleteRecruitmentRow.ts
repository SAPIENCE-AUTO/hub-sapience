import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from '../../server/compat';
import { publishEvent } from '../lib/ably';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default createEndpoint({
  authenticated: true,
  description: 'Soft-delete a recruitment row and its children',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const now = new Date().toISOString();

    // Fetch the row first to get projectCode for Ably publish
    const row = await RecruitmentRows.findOne({ id: input.id });

    // Find child rows
    const { records: children } = await RecruitmentRows.findAll({
      filters: { parentRowId: input.id },
      fields: ['id'],
      limit: 100,
    });

    const allIds = [input.id, ...children.map(c => c.id)];

    // Soft-delete all in batches of 10
    for (let i = 0; i < allIds.length; i += 10) {
      await Promise.all(allIds.slice(i, i + 10).map(id =>
        RecruitmentRows.update({ id, record: { deletedAt: now } })
      ));
      if (i + 10 < allIds.length) await sleep(250);
    }

    // Publish Ably realtime event so other open screens remove the row instantly
    if (row?.projectCode) {
      try {
        await publishEvent(`board:${row.projectCode}`, 'recruitment.deleted', {
          id: input.id,
          projectCode: row.projectCode,
          senderEmail: context?.user?.email ?? '',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] recruitment.deleted publish failed:', err);
      }
    }

    return { success: true };
  },
});
