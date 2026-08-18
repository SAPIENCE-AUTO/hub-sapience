import { z } from 'zod';
import { createEndpoint, Boards } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Save a calendar board\'s invite template (which columns show in the invite email, and in what order)',
  inputSchema: z.object({
    boardId: z.string(),
    order: z.array(z.string()),
    selected: z.array(z.string()),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Boards.update({
      id: input.boardId,
      record: { inviteTemplateJson: JSON.stringify({ order: input.order, selected: input.selected }) },
    });
    return { success: true };
  },
});
