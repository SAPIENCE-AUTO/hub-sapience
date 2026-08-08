import { z } from 'zod';
import { createEndpoint, BoardColumns, Boards } from '../../server/compat';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

const DEBUG =
  typeof process !== 'undefined' && process.env?.DEBUG_BOARD_RESOLUTION === 'true';

const LEGACY_PREFIX_RE = /^(pm-|cal-|recruitment-|events-)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUFFIXES = ['::groups', '::children'] as const;

function extractSuffix(input: string): { base: string; suffix: string } {
  for (const s of SUFFIXES) {
    if (input.endsWith(s)) return { base: input.slice(0, -s.length), suffix: s };
  }
  return { base: input, suffix: '' };
}

export default createEndpoint({
  authenticated: true,
  description: 'Get dynamic columns for a board, sorted by order',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({
    columns: z.array(
      z.object({
        id: z.string(),
        columnName: z.string().optional(),
        boardId: z.string().optional(),
        columnType: z.string().optional(),
        optionsJson: z.string().optional(),
        columnOrder: z.number().optional(),
      }),
    ),
  }),
  execute: async ({ input }) => {
    const originalBoardId = input.boardId;
    const isGroupsBoard = originalBoardId.endsWith('::groups');
    const isLegacyComposite = LEGACY_PREFIX_RE.test(
      originalBoardId.replace(/::groups$|::children$/, ''),
    );

    // ── NON-LEGACY PATH (UUID input) ──────────────────────────────────────────
    if (!isLegacyComposite) {
      const { base, suffix } = extractSuffix(originalBoardId);

      // If UUID, check if it's a recruitment board → merge-read UUID + legacy
      if (UUID_RE.test(base)) {
        const board = await Boards.findOne({ id: base });
        if (!board || board.deletedAt) return { columns: [] };

        if (board.boardType === 'recruitment') {
          // ── RECRUITMENT MERGE-READ: always read from UUID + legacy ─────────
          const legacyBase = `recruitment-${board.projectCode}-${board.boardName}`;
          const legacyId = suffix ? `${legacyBase}${suffix}` : legacyBase;
          const candidates = [originalBoardId];
          if (legacyId !== originalBoardId) candidates.push(legacyId);

          const seenIds = new Set<string>();
          const nameTypeKey = (name: string, type: string) =>
            `${(name || '').trim().toLowerCase()}::${(type || '').trim().toLowerCase()}`;
          const semanticMap = new Map<string, { col: any; isUUID: boolean }>();
          const allActive: any[] = [];

          for (const candidate of candidates) {
            const isUUIDCandidate = UUID_RE.test(candidate.replace(/::groups$|::children$/, ''));
            const { records } = await BoardColumns.findAll({
              filters: { boardId: candidate },
              limit: 500,
            });
            for (const r of records) {
              if (r.deletedAt) continue;
              // Layer 1: exact id dedupe
              if (seenIds.has(r.id)) continue;
              seenIds.add(r.id);
              // Layer 2: semantic dedupe by normalized name + type
              const ntk = nameTypeKey(r.columnName ?? '', r.columnType ?? '');
              const existing = semanticMap.get(ntk);
              if (existing) {
                if (existing.isUUID && !isUUIDCandidate) continue; // keep UUID version
                if (!existing.isUUID && isUUIDCandidate) {
                  // replace legacy with UUID version
                  const idx = allActive.indexOf(existing.col);
                  if (idx !== -1) allActive.splice(idx, 1);
                  semanticMap.set(ntk, { col: r, isUUID: isUUIDCandidate });
                  allActive.push(r);
                  continue;
                }
                // both same source type — keep both (different columns with same name)
              } else {
                semanticMap.set(ntk, { col: r, isUUID: isUUIDCandidate });
              }
              allActive.push(r);
            }
          }

          allActive.sort((a: any, b: any) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

          if (DEBUG) {
            console.log(`[getBoardColumns] recruitment merge-read: ${allActive.length} column(s) from ${candidates.length} candidates`, candidates);
          }

          return { columns: allActive };
        }

        // ── NON-RECRUITMENT UUID: fast path (PM, Calendar, etc.) ─────────────
        const { records: fast } = await BoardColumns.findAll({
          filters: { boardId: originalBoardId },
          limit: 500,
        });
        const fastActive = fast.filter((r) => !r.deletedAt);
        const fastSorted = [...fastActive].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
        if (fastSorted.length > 0) {
          return { columns: fastSorted };
        }
        return { columns: [] };
      }

      // Non-UUID, non-legacy — unexpected format, return empty
      return { columns: [] };
    }

    // ── SLOW PATH: resolve boardId & try candidates ───────────────────────────
    // For legacy IDs we always enter here (columns may be split across legacy
    // and UUID boardIds after partial migration). For UUID IDs we enter only
    // if the fast path found nothing.
    const resolved = await resolveBoardId({
      boardIdOrKey: originalBoardId,
      fallbackToLegacy: true,
    });

    if (DEBUG) {
      console.log('[getBoardColumns] resolution:', {
        input: originalBoardId,
        resolvedBoardId: resolved.boardId,
        legacyBaseId: resolved.legacyBaseId,
        legacyCompositeId: resolved.legacyCompositeId,
        isLegacy: resolved.isLegacy,
        unresolvedLegacy: resolved.unresolvedLegacy ?? false,
        suffix: resolved.suffix,
      });
    }

    // ── Build deduplicated candidate list ─────────────────────────────────────
    const candidates: string[] = [originalBoardId];

    if (resolved.boardId && resolved.boardId !== originalBoardId) {
      candidates.push(resolved.boardId);
    }

    const legacyCandidate = resolved.legacyCompositeId;
    if (
      legacyCandidate &&
      legacyCandidate !== originalBoardId &&
      !candidates.includes(legacyCandidate)
    ) {
      candidates.push(legacyCandidate);
    }

    if (DEBUG) {
      console.log('[getBoardColumns] candidates:', candidates);
    }

    // ── MERGE-READ for ::groups OR legacy composites with multiple candidates ─
    // Columns may be split across legacy and UUID board IDs after partial
    // migration. Merge from ALL candidates and deduplicate by column id.
    if (candidates.length > 1 && (isGroupsBoard || isLegacyComposite)) {
      const seen = new Set<string>();
      const allActive: Array<typeof candidates extends any[] ? any : never> = [];

      for (const candidate of candidates) {
        const { records } = await BoardColumns.findAll({
          filters: { boardId: candidate },
          limit: 500,
        });
        for (const r of records) {
          if (r.deletedAt || seen.has(r.id)) continue;
          seen.add(r.id);
          allActive.push(r);
        }
      }

      allActive.sort((a: any, b: any) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

      if (DEBUG) {
        console.log(`[getBoardColumns] merge-read: ${allActive.length} column(s) from ${candidates.length} candidates:`, candidates);
      }

      return { columns: allActive };
    }

    // ── FIRST-HIT: try each candidate in order (single candidate or UUID) ─────
    for (const candidate of candidates) {
      const { records } = await BoardColumns.findAll({
        filters: { boardId: candidate },
        limit: 500,
      });

      const active = records.filter((r) => !r.deletedAt);
      const sorted = [...active].sort(
        (a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0),
      );

      if (sorted.length > 0) {
        if (DEBUG) {
          const source =
            candidate === originalBoardId
              ? 'original'
              : candidate === resolved.boardId
                ? 'uuid'
                : 'legacy-composite';
          console.log(
            `[getBoardColumns] ${sorted.length} column(s) found via source="${source}" (candidate="${candidate}")`,
          );
        }
        return { columns: sorted };
      }
    }

    if (DEBUG) {
      console.log('[getBoardColumns] no columns found for any candidate:', candidates);
    }

    return { columns: [] };
  },
});
