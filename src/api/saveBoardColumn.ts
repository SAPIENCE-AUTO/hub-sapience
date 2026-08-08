import { z } from 'zod';
import { createEndpoint, BoardColumns } from '../../server/compat';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

const SUFFIXES = ['::groups', '::children'] as const;

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a board column definition. Uses resolveWriteBoardId for UUID migration. Dual-read anti-duplicate logic for create/upsert.',
  inputSchema: z.object({
    id: z.string().optional(),
    columnName: z.string(),
    boardId: z.string(),
    columnType: z.string().optional(),
    optionsJson: z.string().optional(),
    columnOrder: z.number().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const { id, boardId: inputBoardId, columnName, columnType, optionsJson, columnOrder } = input;

    // ── Phase 1: Parse suffix ───────────────────────────────────────────
    let suffix = '' as '' | '::groups' | '::children';
    for (const s of SUFFIXES) {
      if (inputBoardId.endsWith(s)) { suffix = s; break; }
    }
    const originalBase = suffix ? inputBoardId.slice(0, -suffix.length) : inputBoardId;
    const isEventsBoard = originalBase.startsWith('events-');

    // ── Phase 2: Resolve write target ───────────────────────────────────
    let writeBoardId: string;
    let legacyBoardId: string | undefined;

    if (isEventsBoard) {
      writeBoardId = inputBoardId;
      legacyBoardId = undefined;
    } else {
      const resolution = await resolveWriteBoardId(originalBase);
      writeBoardId = suffix ? `${resolution.writeBoardId}${suffix}` : resolution.writeBoardId;

      if (resolution.legacyBoardId) {
        legacyBoardId = suffix ? `${resolution.legacyBoardId}${suffix}` : resolution.legacyBoardId;
      } else if (inputBoardId !== writeBoardId) {
        legacyBoardId = inputBoardId;
      } else {
        legacyBoardId = undefined;
      }

      if (resolution.reason === 'legacy-fallback' || resolution.reason === 'input-passthrough') {
        console.warn(`[saveBoardColumn] Could not resolve ${originalBase} to UUID — fallback (reason=${resolution.reason})`);
      }
    }

    // ── Phase 3a: UPDATE by id ──────────────────────────────────────────
    if (id) {
      const updateRecord: Record<string, unknown> = { boardId: writeBoardId, columnName };
      if (columnType !== undefined) updateRecord.columnType = columnType;
      if (optionsJson !== undefined) updateRecord.optionsJson = optionsJson;
      if (columnOrder !== undefined) updateRecord.columnOrder = columnOrder;

      await BoardColumns.update({ id, record: updateRecord });
      console.log(`[saveBoardColumn] action=updated id=${id} boardId=${writeBoardId} columnName=${columnName}`);
      return { success: true, id };
    }

    // ── Phase 3b: CREATE / UPSERT — dual-read anti-duplicate ────────────
    let existing: { id: string } | null = null;
    let foundUnder: 'uuid' | 'legacy' | null = null;

    // 1. Search under UUID boardId
    try {
      const { records } = await BoardColumns.findAll({
        filters: { boardId: writeBoardId, columnName },
        limit: 1,
      });
      const active = records.find(r => !r.deletedAt);
      if (active) { existing = active; foundUnder = 'uuid'; }
    } catch { /* no match */ }

    // 2. If not found, search under legacy boardId
    if (!existing && legacyBoardId && legacyBoardId !== writeBoardId) {
      try {
        const { records } = await BoardColumns.findAll({
          filters: { boardId: legacyBoardId, columnName },
          limit: 1,
        });
        const active = records.find(r => !r.deletedAt);
        if (active) { existing = active; foundUnder = 'legacy'; }
      } catch { /* no match */ }
    }

    // 3. Write
    if (existing && foundUnder === 'uuid') {
      // Already under UUID — update in place (only provided fields)
      const updateFields: Record<string, unknown> = {};
      if (columnType !== undefined) updateFields.columnType = columnType;
      if (optionsJson !== undefined) updateFields.optionsJson = optionsJson;
      if (columnOrder !== undefined) updateFields.columnOrder = columnOrder;

      if (Object.keys(updateFields).length > 0) {
        await BoardColumns.update({ id: existing.id, record: updateFields });
      }
      console.log(`[saveBoardColumn] action=updated boardId=${writeBoardId} columnName=${columnName}`);
      return { success: true, id: existing.id };
    }

    if (existing && foundUnder === 'legacy') {
      // Found under legacy — move to UUID + update all fields
      const moveRecord: Record<string, unknown> = { boardId: writeBoardId, columnName };
      if (columnType !== undefined) moveRecord.columnType = columnType;
      if (optionsJson !== undefined) moveRecord.optionsJson = optionsJson;
      if (columnOrder !== undefined) moveRecord.columnOrder = columnOrder;

      await BoardColumns.update({ id: existing.id, record: moveRecord });
      console.log(`[saveBoardColumn] action=moved from=${legacyBoardId} to=${writeBoardId} columnName=${columnName}`);
      return { success: true, id: existing.id };
    }

    // Not found — create under UUID
    const createRecord: Record<string, unknown> = { boardId: writeBoardId, columnName };
    if (columnType !== undefined) createRecord.columnType = columnType;
    if (optionsJson !== undefined) createRecord.optionsJson = optionsJson;
    if (columnOrder !== undefined) createRecord.columnOrder = columnOrder;

    const created = await BoardColumns.create({ record: createRecord });
    console.log(`[saveBoardColumn] action=created id=${created.id} boardId=${writeBoardId} columnName=${columnName}`);
    return { success: true, id: created.id };
  },
});
