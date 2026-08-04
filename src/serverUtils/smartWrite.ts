import { CellValues } from 'zite-integrations-backend-sdk';
import { lookupBoardUUID, resolveBoardId } from './resolveBoardId';

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEBUG = typeof process !== 'undefined'
  && process.env?.DEBUG_BOARD_RESOLUTION === 'true';

// ── Types ────────────────────────────────────────────────────────────────────

export type WriteResolution = {
  writeBoardId: string;
  legacyBoardId?: string;
  reason: 'uuid-direct' | 'uuid-resolved' | 'legacy-fallback' | 'input-passthrough';
};

export type SmartWriteParams = {
  uuidBoardId: string;
  legacyBoardId?: string;
  rowId: string;
  columnId: string;
  values: {
    textValue?: string;
    numberValue?: number;
    dateValue?: string;
    booleanValue?: boolean;
    fileUrl?: string;
  };
  isEmpty: boolean;
};

export type SmartWriteResult = {
  id: string;
  action: 'created' | 'updated' | 'moved' | 'deleted' | 'noop';
  boardIdUsed: string;
};

// ── resolveWriteBoardId ──────────────────────────────────────────────────────
//
// Decides the destination boardId for a write operation.
// Does NOT know about rowId / columnId — pure routing.
//
// Priority:
//   1. Input is already UUID          → use directly
//   2. Has projectCode+boardName+type → lookupBoardUUID (fast path)
//   3. Otherwise                      → resolveBoardId  (parse composite)
//   4. Any error                      → input passthrough + warn

export async function resolveWriteBoardId(
  inputBoardId: string,
  opts?: { projectCode?: string; boardName?: string; boardType?: string },
): Promise<WriteResolution> {
  // ── 1. Already a UUID ──────────────────────────────────────────────────
  const base = inputBoardId.split('::')[0];
  if (UUID_RE.test(base)) {
    if (DEBUG) console.log('[resolveWriteBoardId] uuid-direct', { inputBoardId });
    return { writeBoardId: inputBoardId, reason: 'uuid-direct' };
  }

  try {
    // ── 2. Fast path: all three opts provided → lookupBoardUUID ──────────
    if (opts?.projectCode && opts?.boardName && opts?.boardType) {
      const lookup = await lookupBoardUUID(opts.projectCode, opts.boardName, opts.boardType);

      if (lookup.found && lookup.uuid) {
        if (DEBUG) console.log('[resolveWriteBoardId] uuid-resolved via lookup', { inputBoardId, uuid: lookup.uuid });
        return { writeBoardId: lookup.uuid, legacyBoardId: lookup.legacyId, reason: 'uuid-resolved' };
      }

      console.warn('[resolveWriteBoardId] UUID not found, legacy fallback', {
        inputBoardId,
        reason: lookup.reason,
        projectCode: opts.projectCode,
        boardName: opts.boardName,
        boardType: opts.boardType,
      });
      return { writeBoardId: inputBoardId, legacyBoardId: lookup.legacyId, reason: 'legacy-fallback' };
    }

    // ── 3. Slow path: parse composite via resolveBoardId ─────────────────
    const resolved = await resolveBoardId({
      boardIdOrKey: inputBoardId,
      projectCode: opts?.projectCode,
      boardName: opts?.boardName,
      fallbackToLegacy: true,
    });

    if (!resolved.unresolvedLegacy) {
      if (DEBUG) console.log('[resolveWriteBoardId] uuid-resolved via resolveBoardId', {
        inputBoardId, uuid: resolved.baseBoardId,
      });
      return {
        writeBoardId: resolved.baseBoardId,
        legacyBoardId: resolved.legacyBaseId,
        reason: 'uuid-resolved',
      };
    }

    console.warn('[resolveWriteBoardId] Unresolved legacy, fallback', { inputBoardId });
    return { writeBoardId: inputBoardId, legacyBoardId: resolved.legacyBaseId, reason: 'legacy-fallback' };

  } catch (err) {
    console.warn('[resolveWriteBoardId] Error, input passthrough', {
      inputBoardId,
      error: String(err),
    });
    return { writeBoardId: inputBoardId, reason: 'input-passthrough' };
  }
}

// ── smartWriteCellValue ──────────────────────────────────────────────────────
//
// CellValue-specific smart write with anti-duplicate logic.
//
// 1. Search for existing cell under UUID boardId
// 2. If not found, search under legacy boardId
// 3. On write:
//    - found under UUID   → update in place
//    - found under legacy → update + move boardId to UUID
//    - not found          → create under UUID
// 4. Never creates a duplicate for the same rowId + columnId

export async function smartWriteCellValue(params: SmartWriteParams): Promise<SmartWriteResult> {
  const { uuidBoardId, legacyBoardId, rowId, columnId, values, isEmpty } = params;

  // ── Dual-read: UUID first, legacy fallback ─────────────────────────────
  let existing = await CellValues.findOne({
    filters: { boardId: uuidBoardId, rowId, columnId },
  });
  let foundUnder: 'uuid' | 'legacy' | null = existing ? 'uuid' : null;

  if (!existing && legacyBoardId && legacyBoardId !== uuidBoardId) {
    existing = await CellValues.findOne({
      filters: { boardId: legacyBoardId, rowId, columnId },
    });
    if (existing) foundUnder = 'legacy';
  }

  // ── Reconciliation: if BOTH uuid and legacy exist, delete the legacy duplicate ──
  if (existing && foundUnder === 'uuid' && legacyBoardId && legacyBoardId !== uuidBoardId) {
    try {
      const legacyDuplicate = await CellValues.findOne({
        filters: { boardId: legacyBoardId, rowId, columnId },
      });
      if (legacyDuplicate) {
        await CellValues.delete({ id: legacyDuplicate.id });
        console.log('[smartWriteCellValue] Reconciled: deleted legacy duplicate', {
          keptId: existing.id, deletedId: legacyDuplicate.id,
          uuidBoardId, legacyBoardId, rowId, columnId,
        });
      }
    } catch (delErr) {
      console.warn('[smartWriteCellValue] Failed to reconcile legacy duplicate', {
        uuidBoardId, legacyBoardId, rowId, columnId, error: String(delErr),
      });
    }
  }

  // ── DELETE path ────────────────────────────────────────────────────────
  if (isEmpty) {
    if (existing) {
      await CellValues.delete({ id: existing.id });
      if (DEBUG) console.log('[smartWriteCellValue] deleted', { id: existing.id, foundUnder });
      return {
        id: existing.id,
        action: 'deleted',
        boardIdUsed: foundUnder === 'uuid' ? uuidBoardId : legacyBoardId!,
      };
    }
    return { id: '__noop__', action: 'noop', boardIdUsed: uuidBoardId };
  }

  // ── UPSERT path ───────────────────────────────────────────────────────
  const clean = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

  // Found under UUID → update in place
  if (existing && foundUnder === 'uuid') {
    await CellValues.update({ id: existing.id, record: clean });
    if (DEBUG) console.log('[smartWriteCellValue] updated (uuid)', { id: existing.id });
    return { id: existing.id, action: 'updated', boardIdUsed: uuidBoardId };
  }

  // Found under legacy → update + move boardId to UUID
  if (existing && foundUnder === 'legacy') {
    await CellValues.update({ id: existing.id, record: { ...clean, boardId: uuidBoardId } });
    console.log('[smartWriteCellValue] Moved legacy→UUID', {
      id: existing.id,
      from: legacyBoardId,
      to: uuidBoardId,
      rowId,
      columnId,
    });
    return { id: existing.id, action: 'moved', boardIdUsed: uuidBoardId };
  }

  // Not found → create under UUID
  const created = await CellValues.create({
    record: { boardId: uuidBoardId, rowId, columnId, ...clean },
  });
  if (DEBUG) console.log('[smartWriteCellValue] created', { id: created.id, boardId: uuidBoardId });
  return { id: created.id, action: 'created', boardIdUsed: uuidBoardId };
}
