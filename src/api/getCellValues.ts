import { z } from 'zod';
import { createEndpoint, CellValues, Boards } from '../../server/compat';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

const DEBUG =
  typeof process !== 'undefined' && process.env?.DEBUG_BOARD_RESOLUTION === 'true';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUFFIXES_CV = ['::groups', '::children'] as const;

function extractSuffixCV(input: string): { base: string; suffix: string } {
  for (const s of SUFFIXES_CV) {
    if (input.endsWith(s)) return { base: input.slice(0, -s.length), suffix: s };
  }
  return { base: input, suffix: '' };
}

const cellSchema = z.object({
  id: z.string(),
  cellId: z.any().optional(),
  boardId: z.string().optional(),
  rowId: z.string().optional(),
  columnId: z.string().optional(),
  textValue: z.string().optional(),
  numberValue: z.number().optional(),
  dateValue: z.string().optional(),
  booleanValue: z.boolean().optional(),
  fileUrl: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get cell values for a board — paginated so the first page returns immediately',
  inputSchema: z.object({
    boardId: z.string(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  outputSchema: z.object({
    cells: z.array(cellSchema),
    hasMore: z.boolean(),
    nextOffset: z.number(),
  }),
  execute: async ({ input }) => {
    const limit  = input.limit  ?? 500;
    const offset = input.offset ?? 0;
    const originalBoardId = input.boardId;

    // ── Detect legacy composite board IDs ────────────────────────────────────
    // Legacy IDs (pm-X-Y, cal-X-Y, recruitment-X-Y, events-X-Y) may have been
    // migrated to UUID. The fast path would find straggler legacy cells and
    // return only those, missing the bulk of data under UUID. Skip it.
    const isLegacyComposite = /^(pm-|cal-|recruitment-|events-)/.test(
      originalBoardId.replace(/::groups$|::children$/, ''),
    );

    // ── NON-LEGACY PATH (UUID input) ──────────────────────────────────────────
    if (!isLegacyComposite) {
      const { base, suffix } = extractSuffixCV(originalBoardId);

      if (UUID_RE.test(base)) {
        const board = await Boards.findOne({ id: base });
        if (!board || board.deletedAt) {
          return { cells: [], hasMore: false, nextOffset: offset };
        }

        // ── MERGE-READ for recruitment and calendar boards ────────────────
        // These board types may have CellValues split across UUID and legacy
        // boardIds due to the migration. We read from both and deduplicate.
        const needsUuidMerge = board.boardType === 'recruitment' || board.boardType === 'calendar';

        if (needsUuidMerge) {
          const prefix = board.boardType === 'recruitment' ? 'recruitment-' : 'cal-';
          const legacyBase = `${prefix}${board.projectCode}-${board.boardName}`;
          const legacyId = suffix ? `${legacyBase}${suffix}` : legacyBase;
          const candidates = [originalBoardId];
          if (legacyId !== originalBoardId) candidates.push(legacyId);

          const seen = new Map<string, any>(); // key: rowId::columnId → cell record
          const seenIsUUID = new Map<string, boolean>(); // track source type

          for (const candidate of candidates) {
            const isUUIDCandidate = UUID_RE.test(candidate.replace(/::groups$|::children$/, ''));
            let cOffset = 0;
            let cMore = true;
            while (cMore) {
              const { records, hasMore: hm } = await CellValues.findAll({
                filters: { boardId: candidate },
                limit: 2000,
                offset: cOffset,
              });
              for (const r of records) {
                if (r.deletedAt) continue;
                const key = `${r.rowId}::${r.columnId}`;
                const existingIsUUID = seenIsUUID.get(key);
                if (existingIsUUID !== undefined) {
                  // Duplicate — prefer UUID version
                  if (!existingIsUUID && isUUIDCandidate) {
                    seen.set(key, r);
                    seenIsUUID.set(key, true);
                  }
                } else {
                  seen.set(key, r);
                  seenIsUUID.set(key, isUUIDCandidate);
                }
              }
              cMore = hm;
              cOffset += records.length;
            }
          }

          const merged = Array.from(seen.values());
          const page = merged.slice(offset, offset + limit);
          const hasMore = (offset + limit) < merged.length;

          if (DEBUG) {
            console.log(`[getCellValues] ${board.boardType} merge-read: ${merged.length} cell(s) from ${candidates.length} candidates`, candidates);
          }

          return { cells: page, hasMore, nextOffset: offset + page.length };
        }

        // ── NON-MERGE UUID: fast path (PM, etc.) ────────────────────────────
        const { records: fast, hasMore: fastMore } = await CellValues.findAll({
          filters: { boardId: originalBoardId },
          limit,
          offset,
        });
        const fastActive = fast.filter((r) => !r.deletedAt);
        if (fastActive.length > 0 || fastMore) {
          return { cells: fastActive, hasMore: fastMore, nextOffset: offset + fast.length };
        }
        return { cells: [], hasMore: false, nextOffset: offset };
      }

      // Non-UUID, non-legacy — unexpected format, return empty
      return { cells: [], hasMore: false, nextOffset: offset };
    }

    // ── SLOW PATH: resolve boardId & try candidates ───────────────────────────
    // For legacy IDs we always enter here; for UUID IDs we enter only if the
    // fast path found nothing.
    let candidates: string[] = [];

    try {
      const resolved = await resolveBoardId({
        boardIdOrKey: originalBoardId,
        fallbackToLegacy: true,
      });

      if (DEBUG) {
        console.log('[getCellValues] resolution:', {
          input: originalBoardId,
          resolvedBoardId: resolved.boardId,
          legacyCompositeId: resolved.legacyCompositeId,
          isLegacy: resolved.isLegacy,
          unresolvedLegacy: resolved.unresolvedLegacy ?? false,
        });
      }

      // Build deduplicated candidate list — UUID first (canonical), legacy as fallback
      // This ensures post-migration boards serve data from the UUID source.
      const uuidCandidate = resolved.boardId;
      const legacyCandidate = resolved.legacyCompositeId;

      // 1. UUID (resolved) — most data lives here after migration
      if (uuidCandidate && !candidates.includes(uuidCandidate)) {
        candidates.push(uuidCandidate);
      }
      // 2. Original input (if different from both resolved candidates)
      if (!candidates.includes(originalBoardId)) {
        candidates.push(originalBoardId);
      }
      // 3. Legacy composite — fallback for un-migrated boards
      if (
        legacyCandidate &&
        !candidates.includes(legacyCandidate)
      ) {
        candidates.push(legacyCandidate);
      }
    } catch (err) {
      if (DEBUG) {
        console.log('[getCellValues] resolver-error — using original boardId only:', err);
      }
      // candidates already = [originalBoardId], endpoint continues safely
    }

    if (DEBUG) {
      console.log('[getCellValues] candidates:', candidates, { offset, limit });
    }

    // ── MERGE MODE: when data may be split across legacy + UUID boardIds ─────
    // Applies to ::groups/::children AND legacy composite boards (pm-, cal-,
    // recruitment-) where columns/cells can be split after partial migration.
    const needsMerge = candidates.length > 1 && isLegacyComposite;

    if (needsMerge) {
      const seen = new Set<string>();
      const merged: typeof candidates extends string[] ? any[] : never = [];

      for (const candidate of candidates) {
        const { records } = await CellValues.findAll({
          filters: { boardId: candidate },
          limit: 2000,
          offset: 0,
        });

        for (const r of records) {
          if (r.deletedAt) continue;
          // Deduplicate by rowId+columnId (same cell under different boardIds)
          const key = `${r.rowId}::${r.columnId}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(r);
          }
        }
      }

      if (DEBUG) {
        console.log(`[getCellValues] MERGE mode for ${originalBoardId}: ${merged.length} cells from ${candidates.length} candidates`);
      }

      // Apply pagination to the merged set
      const page = merged.slice(offset, offset + limit);
      const hasMore = offset + limit < merged.length;
      return { cells: page, hasMore, nextOffset: offset + page.length };
    }

    // ── Dual-read: try each candidate in order, return on first hit ───────────
    // Rules:
    //   - Never mix results from different candidates
    //   - Return the first candidate that has active records OR hasMore
    //   - Same limit/offset applied to every candidate
    for (const candidate of candidates) {
      const { records, hasMore } = await CellValues.findAll({
        filters: { boardId: candidate },
        limit,
        offset,
      });

      const active = records.filter((r) => !r.deletedAt);

      if (active.length > 0 || hasMore) {
        if (DEBUG) {
          const source =
            candidate === originalBoardId
              ? 'original'
              : candidate === candidates[1]
                ? 'uuid'
                : 'legacy-composite';
          console.log(
            `[getCellValues] source="${source}" candidate="${candidate}"`,
            { cellsFound: active.length, hasMore, offset },
          );
        }
        return { cells: active, hasMore, nextOffset: offset + records.length };
      }
    }

    // ── Nothing found across all candidates ───────────────────────────────────
    if (DEBUG) {
      console.log('[getCellValues] source="empty" — no cells found for any candidate:', candidates);
    }

    return { cells: [], hasMore: false, nextOffset: offset };
  },
});
