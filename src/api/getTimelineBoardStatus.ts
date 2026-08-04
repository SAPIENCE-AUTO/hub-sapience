import { z } from 'zod';
import { createEndpoint, Boards } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Returns timelineVersion and fileUrl for a given PM board',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string().optional(),
    boardId: z.string().optional(),
  }),
  outputSchema: z.object({
    currentVersion: z.number().nullable(),
    fileUrl: z.string().nullable(),
  }),
  execute: async ({ input }) => {
    let board: any = null;

    if (input.boardId) {
      // UUID path — direct lookup
      board = await Boards.findOne({ id: input.boardId });
    } else if (input.boardName) {
      // Legacy fallback with ambiguity check
      const { records } = await Boards.findAll({
        filters: {
          boardName: input.boardName,
          projectCode: input.projectCode,
          boardType: 'pm',
        } as any,
        limit: 10,
      });
      const active = records.filter(b => !b.deletedAt);
      if (active.length > 1) {
        throw new Error(`Ambiguity: ${active.length} active boards named "${input.boardName}" in project ${input.projectCode}. Pass boardId to resolve.`);
      }
      board = active[0] ?? null;
    }

    return {
      currentVersion: board?.timelineVersion ?? null,
      fileUrl: null,
    };
  },
});
