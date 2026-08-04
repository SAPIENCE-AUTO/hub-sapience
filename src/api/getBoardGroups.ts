import { z } from 'zod';
import { createEndpoint, BoardColumns } from 'zite-integrations-backend-sdk';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

const DEBUG =
  typeof process !== 'undefined' && process.env?.DEBUG_BOARD_RESOLUTION === 'true';

export default createEndpoint({
  authenticated: true,
  description: 'Returns the group columns for a given board (boardId::groups)',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({
    groups: z.array(z.object({
      id: z.string(),
      name: z.string(),
      colorId: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    // ── Guard against accidental double-suffix ────────────────────────────────
    const originalGroupsId = input.boardId.endsWith('::groups')
      ? input.boardId
      : `${input.boardId}::groups`;

    // ── Resolve board (safe — no throws, always falls back to legacy) ─────────
    let candidates: string[] = [originalGroupsId];

    try {
      const resolved = await resolveBoardId({
        boardIdOrKey: originalGroupsId,
        fallbackToLegacy: true,
      });

      if (DEBUG) {
        console.log('[getBoardGroups] resolution:', {
          inputBoardId: input.boardId,
          originalGroupsId,
          resolvedBoardId: resolved.boardId,
          legacyCompositeId: resolved.legacyCompositeId,
          suffix: resolved.suffix,
          isLegacy: resolved.isLegacy,
          unresolvedLegacy: resolved.unresolvedLegacy ?? false,
        });
      }

      // Candidate 2: UUID::groups (helper already re-attaches the suffix)
      if (resolved.boardId && resolved.boardId !== originalGroupsId) {
        candidates.push(resolved.boardId);
      }

      // Candidate 3: legacy::groups (inverse case — input is UUID, data is legacy)
      if (
        resolved.legacyCompositeId &&
        resolved.legacyCompositeId !== originalGroupsId &&
        !candidates.includes(resolved.legacyCompositeId)
      ) {
        candidates.push(resolved.legacyCompositeId);
      }
    } catch (err) {
      if (DEBUG) {
        console.log('[getBoardGroups] resolver-error — using originalGroupsId only:', err);
      }
      // candidates already = [originalGroupsId], endpoint continues safely
    }

    if (DEBUG) {
      console.log('[getBoardGroups] candidates:', candidates);
    }

    // ── Merge-read: collect from ALL candidates, deduplicate by column id ────
    // Group columns may exist under both UUID and legacy board IDs after
    // partial migration. Merge to avoid missing groups.
    const seen = new Set<string>();
    const allGroups: { id: string; name: string; colorId?: string; order: number }[] = [];

    for (const candidate of candidates) {
      const { records } = await BoardColumns.findAll({
        filters: { boardId: candidate },
        limit: 500,
      });

      for (const c of records) {
        if (c.deletedAt || seen.has(c.id)) continue;
        seen.add(c.id);
        allGroups.push({
          id: c.id,
          name: c.columnName ?? 'Grupo',
          colorId: c.columnType ?? undefined,
          order: c.columnOrder ?? 0,
        });
      }
    }

    allGroups.sort((a, b) => a.order - b.order);

    if (DEBUG) {
      console.log(`[getBoardGroups] merged ${allGroups.length} groups from ${candidates.length} candidates:`, candidates);
    }

    return {
      groups: allGroups.map(g => ({
        id: g.id,
        name: g.name,
        colorId: g.colorId,
      })),
    };
  },
});
