import { z } from 'zod';
import { createEndpoint, RecruitmentRows, BoardColumns, Boards } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get soft-deleted boards and rows for a project (UUID-forward with legacy fallback)',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({
    boards: z.array(z.object({
      boardId: z.string(),
      boardName: z.string(),
      deletedAt: z.string(),
      deletedBy: z.string().optional(),
      rowCount: z.number(),
    })),
    rows: z.array(z.object({
      id: z.string(),
      participantName: z.string().optional(),
      email: z.string().optional(),
      boardName: z.string().optional(),
      deletedAt: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    // ── 1. Fetch boards for this project from Boards table ──────────────
    const { records: projectBoards } = await Boards.findAll({
      filters: { projectCode: input.projectCode },
      limit: 200,
    });

    // Get all board UUIDs for this project (active + deleted)
    const allBoardUuids = projectBoards.map(b => b.id);
    const legacyPrefix = `recruitment-${input.projectCode}-`;

    // ── 2. Find deleted board columns (UUID + legacy) ──────────────────
    // Search by UUID boards
    const colResults: any[] = [];
    for (const uuid of allBoardUuids) {
      const { records } = await BoardColumns.findAll({
        filters: { boardId: uuid },
        fields: ['id', 'boardId', 'deletedAt', 'deletedBy'],
        limit: 200,
      });
      colResults.push(...records);
    }
    // Also search legacy prefix for boards that may not have been migrated
    const { records: legacyCols } = await BoardColumns.findAll({
      filters: { boardId: { contains: legacyPrefix } },
      fields: ['id', 'boardId', 'deletedAt', 'deletedBy'],
      limit: 500,
    });
    const seenColIds = new Set(colResults.map(c => c.id));
    for (const lc of legacyCols) {
      if (!seenColIds.has(lc.id)) colResults.push(lc);
    }

    // Group deleted columns by boardId
    const boardMap = new Map<string, { boardId: string; boardName: string; deletedAt: string; deletedBy?: string }>();
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const col of colResults) {
      if (!col.deletedAt || !col.boardId) continue;
      const existing = boardMap.get(col.boardId);
      // Derive boardName from UUID lookup or legacy parse
      let boardName = '';
      if (UUID_RE.test(col.boardId)) {
        const board = projectBoards.find(b => b.id === col.boardId);
        boardName = board?.boardName ?? col.boardId;
      } else if (col.boardId.startsWith(legacyPrefix)) {
        boardName = col.boardId.slice(legacyPrefix.length);
      } else {
        continue;
      }
      if (!existing) {
        boardMap.set(col.boardId, {
          boardId: col.boardId,
          boardName,
          deletedAt: col.deletedAt,
          deletedBy: col.deletedBy ?? undefined,
        });
      } else if (!existing.deletedBy && col.deletedBy) {
        boardMap.set(col.boardId, { ...existing, deletedBy: col.deletedBy });
      }
    }

    // ── 3. Find deleted recruitment rows ─────────────────────────────────
    const { records: allRows } = await RecruitmentRows.findAll({
      filters: { projectCode: input.projectCode },
      fields: ['id', 'participantName', 'email', 'boardName', 'deletedAt', 'parentRowId'],
      limit: 2000,
    });

    const deletedRows = allRows.filter(r => !!r.deletedAt);
    const deletedBoardNames = new Set([...boardMap.values()].map(b => b.boardName));

    const individuallyDeleted = deletedRows
      .filter(r => !deletedBoardNames.has(r.boardName ?? '') && !r.parentRowId)
      .map(r => ({
        id: r.id,
        participantName: r.participantName,
        email: r.email,
        boardName: r.boardName,
        deletedAt: r.deletedAt!,
      }));

    const boards = [...boardMap.values()].map(b => ({
      ...b,
      rowCount: deletedRows.filter(r => r.boardName === b.boardName).length,
    }));

    return { boards, rows: individuallyDeleted };
  },
});
