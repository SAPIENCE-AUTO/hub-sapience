import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get all recruitment groups for a project, with their current linked event (if any)',
  inputSchema: z.object({
    projectCode: z.string(),
  }),
  outputSchema: z.object({
    groups: z.array(z.object({
      groupId: z.string(),
      groupName: z.string(),
      boardName: z.string(),
      recruitmentBoardId: z.string(),
      linkedEventId: z.string().optional(),
      linkedCalBoardId: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const { projectCode } = input;

    // 1. Find all recruitment boards for this project
    const boardsResult = await Boards.findAll({
      filters: { projectCode },
      limit: 200,
    });

    const recBoards = boardsResult.records.filter(
      b => !b.deletedAt && !!b.boardName && b.boardType !== 'pm' && b.boardType !== 'calendar'
    );

    const groups: {
      groupId: string;
      groupName: string;
      boardName: string;
      recruitmentBoardId: string;
      linkedEventId?: string;
      linkedCalBoardId?: string;
    }[] = [];

    // 2. For each recruitment board, fetch group columns from BOTH UUID and legacy
    for (const board of recBoards) {
      const boardName = board.boardName!;
      const recruitmentBoardId = `recruitment-${projectCode}-${boardName}`;
      const legacyGroupId = `${recruitmentBoardId}::groups`;
      const uuidGroupId = `${board.id}::groups`;

      // Fetch from both sources in parallel, merge & deduplicate by column id
      // Build candidate board IDs (deduplicated)
      const groupBoardIds = [uuidGroupId];
      if (legacyGroupId !== uuidGroupId) groupBoardIds.push(legacyGroupId);

      const colResults = await Promise.all(
        groupBoardIds.map(id => BoardColumns.findAll({ filters: { boardId: id }, limit: 200 }))
      );

      const seen = new Set<string>();
      const allCols = colResults.flatMap(r => r.records); // UUID first

      for (const col of allCols) {
        if (col.deletedAt || !col.columnName || seen.has(col.id)) continue;
        seen.add(col.id);

        let linkedEventId: string | undefined;
        let linkedCalBoardId: string | undefined;

        // Parse optionsJson for linkedCalEvent
        if (col.optionsJson) {
          try {
            const opts = JSON.parse(col.optionsJson) as Record<string, unknown>;
            const link = opts.linkedCalEvent as { calBoardId?: string; eventId?: string } | undefined;
            if (link?.eventId) {
              linkedEventId = link.eventId;
              linkedCalBoardId = link.calBoardId;
            }
          } catch { /* ignore */ }
        }

        groups.push({
          groupId: col.id,
          groupName: col.columnName,
          boardName,
          recruitmentBoardId,
          linkedEventId,
          linkedCalBoardId,
        });
      }
    }

    return { groups };
  },
});
