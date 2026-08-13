import { z } from 'zod';
import { createEndpoint, BoardColumns, CellValues } from '../../server/compat';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';

const LINKED_GROUP_COLUMN_NAME = 'Grupo vinculado';

export default createEndpoint({
  authenticated: true,
  description: 'Link (or unlink) a recruitment group to a calendar event — bidirectional, idempotent',
  inputSchema: z.object({
    groupColumnId: z.string(),
    recruitmentBoardId: z.string(),
    calendarBoardId: z.string(),
    eventId: z.string(),
    unlink: z.boolean().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const { groupColumnId, recruitmentBoardId, calendarBoardId, eventId, unlink } = input;

    // ── Resolve both boardIds to UUIDs ────────────────────────────────────
    let resolvedRecruitmentId = recruitmentBoardId;
    try {
      const res = await resolveWriteBoardId(recruitmentBoardId);
      resolvedRecruitmentId = res.writeBoardId;
    } catch { /* keep input */ }

    let resolvedCalendarId = calendarBoardId;
    let resolvedCalLegacyId: string | undefined = calendarBoardId;
    try {
      const res = await resolveWriteBoardId(calendarBoardId);
      resolvedCalendarId = res.writeBoardId;
      resolvedCalLegacyId = res.legacyBoardId ?? calendarBoardId;
      if (res.reason === 'legacy-fallback' || res.reason === 'input-passthrough') {
        console.warn('[linkGroupToEvent] Calendar UUID not found, using legacy', { calendarBoardId, reason: res.reason });
      }
    } catch (err) {
      console.warn('[linkGroupToEvent] resolveWriteBoardId failed for calendar', { calendarBoardId, error: String(err) });
    }

    // ── 1. Read the group's BoardColumn ────────────────────────────────────
    const groupCol = await BoardColumns.findOne({ id: groupColumnId });
    if (!groupCol) throw new Error(`Group column ${groupColumnId} not found`);

    let opts: Record<string, unknown> = {};
    try { opts = JSON.parse(groupCol.optionsJson ?? '{}'); } catch { /* keep empty */ }

    // ── 2. Clean up old inverse CellValue if there was a previous link ─────
    const prevLink = opts.linkedCalEvent as { calBoardId?: string; eventId?: string } | undefined;
    if (prevLink?.eventId && prevLink?.calBoardId) {
      const prevBoardId = prevLink.calBoardId;

      // Dual-read for the "Grupo vinculado" column
      let oldCalCol = (await BoardColumns.findAll({
        filters: { boardId: prevBoardId, columnName: LINKED_GROUP_COLUMN_NAME },
        limit: 1,
      })).records[0];

      if (!oldCalCol) {
        try {
          const prevResolution = await resolveWriteBoardId(prevBoardId);
          if (prevResolution.writeBoardId !== prevBoardId) {
            oldCalCol = (await BoardColumns.findAll({
              filters: { boardId: prevResolution.writeBoardId, columnName: LINKED_GROUP_COLUMN_NAME },
              limit: 1,
            })).records[0];
          }
          if (!oldCalCol && prevResolution.legacyBoardId && prevResolution.legacyBoardId !== prevBoardId && prevResolution.legacyBoardId !== prevResolution.writeBoardId) {
            oldCalCol = (await BoardColumns.findAll({
              filters: { boardId: prevResolution.legacyBoardId, columnName: LINKED_GROUP_COLUMN_NAME },
              limit: 1,
            })).records[0];
          }
        } catch { /* skip — best effort cleanup */ }
      }

      if (oldCalCol) {
        let oldCell = await CellValues.findOne({
          filters: { boardId: prevBoardId, rowId: prevLink.eventId, columnId: oldCalCol.id },
        });
        if (!oldCell) {
          const altBoardId = prevBoardId === resolvedCalendarId ? resolvedCalLegacyId : resolvedCalendarId;
          if (altBoardId && altBoardId !== prevBoardId) {
            oldCell = await CellValues.findOne({
              filters: { boardId: altBoardId, rowId: prevLink.eventId, columnId: oldCalCol.id },
            });
          }
        }
        if (oldCell) await CellValues.delete({ id: oldCell.id });
      }
    }

    // ── 3. Update the group's optionsJson ──────────────────────────────────
    if (unlink) {
      delete opts.linkedCalEvent;
    } else {
      opts.linkedCalEvent = { calBoardId: resolvedCalendarId, eventId };
    }
    await BoardColumns.update({ id: groupColumnId, record: { optionsJson: JSON.stringify(opts) } });

    // ── 4. Get or create the "Grupo vinculado" column on the cal board ─────
    // Search under UUID first
    let calCol = (await BoardColumns.findAll({
      filters: { boardId: resolvedCalendarId, columnName: LINKED_GROUP_COLUMN_NAME },
      limit: 1,
    })).records[0];

    // Fallback: search under legacy
    if (!calCol && resolvedCalLegacyId && resolvedCalLegacyId !== resolvedCalendarId) {
      calCol = (await BoardColumns.findAll({
        filters: { boardId: resolvedCalLegacyId, columnName: LINKED_GROUP_COLUMN_NAME },
        limit: 1,
      })).records[0];
    }

    // Create under UUID if not found anywhere. columnType '__linked_group__'
    // (not 'Texto') — this column stores an internal reference
    // (recruitmentBoardId::groupColumnId), never meant for a human to read;
    // useDynamicColumns.ts excludes it from every grid the same way it
    // already excludes '__fillout_link__'.
    if (!calCol) {
      calCol = await BoardColumns.create({
        record: {
          boardId: resolvedCalendarId,
          columnName: LINKED_GROUP_COLUMN_NAME,
          columnType: '__linked_group__',
          columnOrder: 9999,
        },
      });
    }

    // ── 5. Upsert / delete the inverse CellValue on the event ─────────────
    if (unlink) {
      await smartWriteCellValue({
        uuidBoardId: resolvedCalendarId,
        legacyBoardId: resolvedCalLegacyId,
        rowId: eventId,
        columnId: calCol.id,
        values: {},
        isEmpty: true,
      });
    } else {
      const textValue = `${resolvedRecruitmentId}::${groupColumnId}`;
      await smartWriteCellValue({
        uuidBoardId: resolvedCalendarId,
        legacyBoardId: resolvedCalLegacyId,
        rowId: eventId,
        columnId: calCol.id,
        values: { textValue },
        isEmpty: false,
      });
    }

    return { success: true };
  },
});
