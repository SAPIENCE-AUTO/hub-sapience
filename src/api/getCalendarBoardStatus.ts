import { z } from 'zod';
import { createEndpoint, Boards } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Returns calendarVersion and calendarFileUrl for a given calendar board',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    calendarName: z.string().optional(),
    boardId: z.string().optional(),
  }),
  outputSchema: z.object({
    version: z.number().nullable(),
    fileUrl: z.string().nullable(),
  }),
  execute: async ({ input }) => {
    let board: any = null;

    if (input.boardId) {
      // UUID-first: direct lookup by ID
      board = await Boards.findOne({ id: input.boardId });
    } else {
      // Legacy fallback — require projectCode + calendarName
      if (!input.projectCode || !input.calendarName) {
        throw new Error('Either boardId or both projectCode and calendarName are required.');
      }

      // Ambiguity detection
      const { records } = await Boards.findAll({
        filters: {
          boardName: input.calendarName,
          projectCode: input.projectCode,
          boardType: 'calendar',
        } as any,
        limit: 10,
      });
      const activeBoards = records.filter(b => !b.deletedAt);
      if (activeBoards.length > 1) {
        throw new Error(`Ambiguity: ${activeBoards.length} calendars named "${input.calendarName}" for project ${input.projectCode}. Pass boardId to disambiguate.`);
      }
      board = activeBoards[0] ?? null;
    }

    return {
      version: board?.calendarVersion ?? null,
      fileUrl: board?.calendarFileUrl ?? null,
    };
  },
});
