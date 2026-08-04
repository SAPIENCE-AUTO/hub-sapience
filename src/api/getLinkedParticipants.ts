import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from 'zite-integrations-backend-sdk';

const participantSchema = z.object({
  id: z.string(),
  rowName: z.string().optional(),
  participantName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  status: z.string().optional(),
  cellData: z.string().optional(),
  rowOrder: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get participants belonging to a specific recruitment group (groupColumnId) within a board',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string(),
    groupColumnId: z.string(),
  }),
  outputSchema: z.object({
    participants: z.array(participantSchema),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName, groupColumnId } = input;

    const allRows: z.infer<typeof participantSchema>[] = [];
    let offset = 0;

    while (true) {
      const { records, hasMore } = await RecruitmentRows.findAll({
        filters: { projectCode, boardName, group: groupColumnId },
        limit: 500,
        offset,
      });

      const active = records.filter(r => !r.deletedAt);
      allRows.push(
        ...active.map(r => ({
          id: r.id,
          rowName: r.rowName,
          participantName: r.participantName,
          email: r.email,
          phone: r.phone,
          status: r.status,
          cellData: r.cellData,
          rowOrder: r.rowOrder,
        }))
      );

      if (!hasMore || records.length === 0) break;
      offset += records.length;
    }

    // Sort by rowOrder
    allRows.sort((a, b) => (a.rowOrder ?? 0) - (b.rowOrder ?? 0));

    return { participants: allRows };
  },
});
