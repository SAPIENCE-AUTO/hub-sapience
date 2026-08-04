import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Boards } from 'zite-integrations-backend-sdk';

const dedup = <T extends { id: string }>(a: T[], b: T[]): T[] => {
  const seen = new Map<string, T>();
  for (const r of a) seen.set(r.id, r);
  for (const r of b) if (!seen.has(r.id)) seen.set(r.id, r);
  return Array.from(seen.values());
};

const rowSchema = z.object({
  id: z.string(),
  rowName: z.string().optional(),
  projectCode: z.string().optional(),
  boardName: z.string().optional(),
  boardId: z.string().optional(),
  participantName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  idNumber: z.string().optional(),
  status: z.string().optional(),
  group: z.string().optional(),
  parentRowId: z.string().optional(),
  level: z.number().optional(),
  ndaSent: z.boolean().optional(),
  ndaSentDate: z.string().optional(),
  notes: z.string().optional(),
  sourceForm: z.string().optional(),
  cellData: z.string().optional(),
  rowOrder: z.number().optional(),
});

/** Paginated fetch helper */
async function fetchAllPages(filters: Record<string, unknown>): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const result = await RecruitmentRows.findAll({ filters, limit: 2000, offset });
    const active = result.records.filter((r: any) => !r.deletedAt);
    all.push(...active);
    if (!result.hasMore || result.records.length === 0) break;
    offset += result.records.length;
  }
  return all;
}

export default createEndpoint({
  authenticated: true,
  description: 'Get recruitment rows for a project, plus all persisted boards (even empty ones)',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    boardName: z.string().optional(),
    boardId: z.string().optional(),
  }),
  outputSchema: z.object({
    rows: z.array(rowSchema),
    boards: z.array(z.string()),
    boardObjects: z.array(z.object({ id: z.string(), name: z.string(), boardType: z.string().optional(), boardOrder: z.number().optional() })),
  }),
  execute: async ({ input }) => {
    const boardFilters: Record<string, unknown> = {};
    if (input.projectCode) boardFilters.projectCode = input.projectCode;

    // Always fetch boards from the Boards table (never from rows)
    const boardsResult = await Boards.findAll({ filters: boardFilters, limit: 200 });
    const boardsFromTable = boardsResult.records
      .filter(b => !b.deletedAt && !!b.boardName && b.boardType !== 'pm' && b.boardType !== 'calendar')
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => b.boardName as string);

    const boardObjects = boardsResult.records
      .filter(b => !b.deletedAt && !!b.boardName && b.boardType !== 'pm' && b.boardType !== 'calendar')
      .sort((a, b) => (a.boardOrder ?? 0) - (b.boardOrder ?? 0))
      .map(b => ({ id: b.id, name: b.boardName as string, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 }));

    // ── Dual-read by boardId ──
    if (input.boardId) {
      const q1Filters: Record<string, unknown> = { boardId: input.boardId };
      if (input.projectCode) q1Filters.projectCode = input.projectCode;
      const q1Rows = await fetchAllPages(q1Filters);

      let fallback: any[] = [];
      if (input.projectCode && input.boardName) {
        const q2Rows = await fetchAllPages({ projectCode: input.projectCode, boardName: input.boardName });
        fallback = q2Rows.filter((r: any) => !r.boardId);
      }

      const rows = dedup(q1Rows, fallback);
      return { rows, boards: boardsFromTable, boardObjects };
    }

    // ── Legacy path (unchanged) ──
    // If only board list is needed (no boardName filter), return early without fetching rows
    if (!input.boardName) {
      return { rows: [], boards: boardsFromTable, boardObjects };
    }

    const rowFilters: Record<string, unknown> = {};
    if (input.projectCode) rowFilters.projectCode = input.projectCode;
    if (input.boardName) rowFilters.boardName = input.boardName;

    const allRows = await fetchAllPages(rowFilters);
    return { rows: allRows, boards: boardsFromTable, boardObjects };
  },
});
