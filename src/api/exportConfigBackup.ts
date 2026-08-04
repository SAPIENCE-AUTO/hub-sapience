import { z } from 'zod';
import { createEndpoint, BoardColumns, SharedViews, Boards } from 'zite-integrations-backend-sdk';
import type { BoardsRecordType, BoardColumnsRecordType, SharedViewsRecordType } from 'zite-integrations-backend-sdk';

async function loadAllBoards(): Promise<BoardsRecordType[]> {
  const all: BoardsRecordType[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await Boards.findAll({ offset, limit: 2000 });
    all.push(...res.records);
    hasMore = res.hasMore;
    offset += res.records.length;
  }
  return all;
}

function buildBoardMaps(boards: BoardsRecordType[]) {
  const byId = new Map<string, BoardsRecordType>();
  const legacy = new Map<string, BoardsRecordType>();
  for (const b of boards) {
    byId.set(b.id, b);
    const pc = b.projectCode || '';
    const bn = b.boardName || '';
    for (const prefix of ['pm-', 'cal-', 'recruitment-']) {
      const key = bn ? `${prefix}${pc}-${bn}` : `${prefix}${pc}`;
      if (!legacy.has(key)) legacy.set(key, b);
    }
  }
  return { byId, legacy };
}

function resolveBoard(boardId: string, maps: ReturnType<typeof buildBoardMaps>): BoardsRecordType | null {
  return maps.byId.get(boardId) || maps.legacy.get(boardId) || null;
}

export default createEndpoint({
  authenticated: true,
  description: 'Export BoardColumns or SharedViews as a full JSON backup with board resolution and stats',
  inputSchema: z.object({
    table: z.enum(['BoardColumns', 'SharedViews']),
  }),
  outputSchema: z.object({
    jsonData: z.string(),
  }),
  execute: async ({ input }) => {
    const boards = await loadAllBoards();
    const maps = buildBoardMaps(boards);

    if (input.table === 'BoardColumns') {
      // Paginate all BoardColumns
      const all: BoardColumnsRecordType[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await BoardColumns.findAll({ offset, limit: 2000 });
        all.push(...res.records);
        hasMore = res.hasMore;
        offset += res.records.length;
      }

      const enriched = all.map(c => {
        const bid = c.boardId || '';
        const board = resolveBoard(bid, maps);
        return {
          columnId: c.id,
          columnName: c.columnName,
          columnType: c.columnType,
          columnOrder: c.columnOrder,
          optionsJson: c.optionsJson || null,
          deletedAt: c.deletedAt || null,
          deletedBy: c.deletedBy || null,
          currentBoardId: bid,
          resolvedBoardUUID: board?.id || null,
          boardProjectCode: board?.projectCode || null,
          boardName: board?.boardName || null,
          boardType: board?.boardType || null,
          boardDeleted: board?.deletedAt ? true : false,
        };
      });

      const active = enriched.filter(c => !c.deletedAt);
      const deleted = enriched.filter(c => c.deletedAt);
      const resolved = enriched.filter(c => c.resolvedBoardUUID);

      const byProject: Record<string, { active: number; deleted: number; total: number }> = {};
      for (const c of enriched) {
        const pc = c.boardProjectCode || '(unresolved)';
        if (!byProject[pc]) byProject[pc] = { active: 0, deleted: 0, total: 0 };
        byProject[pc].total++;
        if (c.deletedAt) byProject[pc].deleted++;
        else byProject[pc].active++;
      }

      const byBoardId: Record<string, number> = {};
      for (const c of enriched) {
        const bid = c.currentBoardId || '(none)';
        byBoardId[bid] = (byBoardId[bid] || 0) + 1;
      }

      const backup = {
        _exportType: 'BoardColumns_Backup',
        _exportDate: new Date().toISOString(),
        _summary: {
          totalColumns: all.length,
          activeColumns: active.length,
          deletedColumns: deleted.length,
          resolvedToBoard: resolved.length,
          unresolvedColumns: all.length - resolved.length,
          projectCount: Object.keys(byProject).length,
          uniqueBoardIds: Object.keys(byBoardId).length,
        },
        _countsByProject: byProject,
        _countsByBoardId: byBoardId,
        records: enriched,
      };

      return { jsonData: JSON.stringify(backup, null, 2) };
    }

    // SharedViews
    const all: SharedViewsRecordType[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await SharedViews.findAll({ offset, limit: 2000 });
      all.push(...res.records);
      hasMore = res.hasMore;
      offset += res.records.length;
    }

    const enriched = all.map(v => {
      const bid = v.boardId || '';
      const board = resolveBoard(bid, maps);
      return {
        viewId: v.id,
        viewName: v.viewName,
        boardId: bid,
        projectCode: v.projectCode || null,
        boardName: v.boardName || null,
        token: v.token || null,
        sharedToken: v.sharedToken || null,
        filtersJson: v.filtersJson || null,
        visibleColumnsJson: v.visibleColumnsJson || null,
        createdBy: v.createdBy || null,
        active: v.active,
        type: v.type || null,
        viewOrder: v.viewOrder,
        resolvedBoardUUID: board?.id || null,
        resolvedBoardType: board?.boardType || null,
        boardDeleted: board?.deletedAt ? true : false,
      };
    });

    const activeViews = enriched.filter(v => v.active !== false);
    const inactiveViews = enriched.filter(v => v.active === false);
    const internal = enriched.filter(v => v.type === 'Internal');
    const external = enriched.filter(v => v.type === 'External');
    const resolved = enriched.filter(v => v.resolvedBoardUUID);

    const byProject: Record<string, { active: number; inactive: number; total: number }> = {};
    for (const v of enriched) {
      const pc = v.projectCode || '(none)';
      if (!byProject[pc]) byProject[pc] = { active: 0, inactive: 0, total: 0 };
      byProject[pc].total++;
      if (v.active === false) byProject[pc].inactive++;
      else byProject[pc].active++;
    }

    const byBoardId: Record<string, number> = {};
    for (const v of enriched) {
      const bid = v.boardId || '(none)';
      byBoardId[bid] = (byBoardId[bid] || 0) + 1;
    }

    const backup = {
      _exportType: 'SharedViews_Backup',
      _exportDate: new Date().toISOString(),
      _summary: {
        totalViews: all.length,
        activeViews: activeViews.length,
        inactiveViews: inactiveViews.length,
        internalViews: internal.length,
        externalViews: external.length,
        resolvedToBoard: resolved.length,
        unresolvedViews: all.length - resolved.length,
        projectCount: Object.keys(byProject).length,
        uniqueBoardIds: Object.keys(byBoardId).length,
      },
      _countsByProject: byProject,
      _countsByBoardId: byBoardId,
      records: enriched,
    };

    return { jsonData: JSON.stringify(backup, null, 2) };
  },
});
