import { z } from 'zod';
import { createEndpoint, CellValues, BoardColumns, CalendarEvents, RecruitmentRows, Tasks, Users, Boards } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';
import { resolveBoardId } from '../serverUtils/resolveBoardId';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar dynamic columns that mirror native CalendarEvents fields
// ─────────────────────────────────────────────────────────────────────────────
const CAL_SYNC_COLUMNS: Record<string, 'eventDate' | 'durationHours' | 'location' | 'attendees'> = {
  'Fecha y hora':        'eventDate',
  'Duración (hrs)':      'durationHours',
  'Ubicación (interna)': 'location',
  'Ubicación Interna':   'location',
  'Espacio':             'location',
  'Moderador':           'attendees',
  'Persona/Moderador':   'attendees',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_WRITE_PREFIXES = ['recruitment-', 'cal-', 'pm-'] as const;
const SUFFIXES = ['::groups', '::children'] as const;

export default createEndpoint({
  authenticated: true,
  description: 'Upsert a single cell value. Uses resolveWriteBoardId + smartWriteCellValue for UUID migration. events- boards stay legacy permanently. Writes to CellValues, syncs CalendarEvents native fields, syncs Tasks.startDate/endDate for pm boards, and updates denormalized cellData on RecruitmentRows.',
  inputSchema: z.object({
    boardId:      z.string(),
    rowId:        z.string(),
    columnId:     z.string(),
    projectCode:  z.string().optional(),
    textValue:    z.string().optional(),
    numberValue:  z.number().optional(),
    dateValue:    z.string().optional(),
    booleanValue: z.boolean().optional(),
    fileUrl:      z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string(), inviteStatusChanged: z.boolean().optional() }),
  execute: async ({ input, context }) => {
    const { boardId, rowId, columnId, projectCode: inputProjectCode, ...values } = input;

    // ── Phase 1: Parse suffix + detect type ─────────────────────────────
    let suffix = '' as '' | '::groups' | '::children';
    for (const s of SUFFIXES) {
      if (boardId.endsWith(s)) { suffix = s; break; }
    }
    const originalBase = suffix ? boardId.slice(0, -suffix.length) : boardId;
    const originalBoardId = boardId;

    const isEventsBoard = originalBase.startsWith('events-');
    const isLegacyWritePrefix = LEGACY_WRITE_PREFIXES.some(p => originalBase.startsWith(p));
    const isUuid = UUID_RE.test(originalBase);

    // Board type resolved from prefix or UUID lookup — used for Phase 5/6 detection
    let resolvedBoardType: string | undefined =
      originalBase.startsWith('pm-')          ? 'pm' :
      originalBase.startsWith('cal-')         ? 'calendar' :
      originalBase.startsWith('recruitment-') ? 'recruitment' :
      originalBase.startsWith('events-')      ? 'events' : undefined;

    let entityType =
      originalBase.startsWith('pm-')          ? 'task' :
      originalBase.startsWith('cal-')         ? 'event' :
      originalBase.startsWith('recruitment-') ? 'recruitmentRow' : 'unknown';

    let resolvedProjectCode: string | undefined = inputProjectCode;

    // ── Phase 2: Resolve write target ───────────────────────────────────
    let writeBoardId: string;
    let legacyBoardId: string | undefined;

    if (isEventsBoard) {
      // events- → permanent legacy, no UUID resolution ever
      writeBoardId = boardId;
      legacyBoardId = undefined;
    } else if (isLegacyWritePrefix) {
      // pm-, cal-, recruitment- → resolve base to UUID
      const resolution = await resolveWriteBoardId(originalBase);
      writeBoardId = suffix ? `${resolution.writeBoardId}${suffix}` : resolution.writeBoardId;
      legacyBoardId = suffix ? `${originalBase}${suffix}` : originalBase;
      if (resolution.reason === 'legacy-fallback' || resolution.reason === 'input-passthrough') {
        console.warn(`[saveCellValue] Could not resolve ${originalBase} to UUID — fallback (reason=${resolution.reason})`);
      } else {
        console.log(`[saveCellValue] Resolved legacy ${originalBase} → ${resolution.writeBoardId}`);
      }
    } else if (isUuid) {
      // UUID → already correct target; find legacy equivalent for dual-read
      writeBoardId = boardId;
      try {
        const resolved = await resolveBoardId({ boardIdOrKey: originalBase, fallbackToLegacy: true });
        legacyBoardId = resolved.legacyBaseId
          ? (suffix ? `${resolved.legacyBaseId}${suffix}` : resolved.legacyBaseId)
          : undefined;
        resolvedProjectCode = resolvedProjectCode ?? resolved.projectCode ?? undefined;
        // Resolve boardType from the UUID lookup so Phase 5/6 work for UUID boards
        resolvedBoardType = resolved.boardType || resolvedBoardType;
        if (resolvedBoardType === 'calendar') entityType = 'event';
        else if (resolvedBoardType === 'pm') entityType = 'task';
        else if (resolvedBoardType === 'recruitment') entityType = 'recruitmentRow';

        // Fallback: if legacyBaseId is empty/missing for calendar boards, compute from CalendarEvents
        if (!legacyBoardId && resolvedBoardType === 'calendar' && resolvedProjectCode) {
          try {
            const probeEvent = await CalendarEvents.findOne({ id: rowId });
            if (probeEvent?.calendarName) {
              legacyBoardId = suffix
                ? `cal-${resolvedProjectCode}-${probeEvent.calendarName}${suffix}`
                : `cal-${resolvedProjectCode}-${probeEvent.calendarName}`;
              console.log(`[saveCellValue] Computed legacyBoardId from CalendarEvents probe: ${legacyBoardId}`);
            }
          } catch { /* skip */ }
        }
      } catch (resolveErr) {
        legacyBoardId = undefined;
        console.warn(`[saveCellValue] resolveBoardId failed for UUID ${originalBase}:`, resolveErr);
        // Fallback: try to infer boardType by probing CalendarEvents (lightweight — only runs on error path)
        if (!resolvedBoardType) {
          try {
            const probeEvent = await CalendarEvents.findOne({ id: rowId });
            if (probeEvent) {
              resolvedBoardType = 'calendar';
              entityType = 'event';
              resolvedProjectCode = resolvedProjectCode ?? probeEvent.projectCode ?? undefined;
              console.log(`[saveCellValue] Inferred boardType=calendar from CalendarEvents probe for rowId=${rowId}`);
            }
          } catch { /* probe failed — leave boardType unknown */ }
        }
      }

      // ── Post-resolve: ensure legacyBoardId is computed when possible ───
      if (!legacyBoardId && resolvedProjectCode) {
        if (resolvedBoardType === 'calendar') {
          try {
            const probeEvent = await CalendarEvents.findOne({ id: rowId });
            if (probeEvent?.calendarName && probeEvent?.projectCode) {
              legacyBoardId = suffix
                ? `cal-${probeEvent.projectCode}-${probeEvent.calendarName}${suffix}`
                : `cal-${probeEvent.projectCode}-${probeEvent.calendarName}`;
              console.log(`[saveCellValue] Fallback legacyBoardId from CalendarEvents: ${legacyBoardId}`);
            }
          } catch { /* skip */ }
        } else if (resolvedBoardType && resolvedBoardType !== 'events') {
          try {
            const board = await Boards.findOne({ id: originalBase });
            if (board?.boardName && board?.projectCode) {
              const prefix = resolvedBoardType === 'recruitment' ? 'recruitment-' : 'pm-';
              legacyBoardId = suffix
                ? `${prefix}${board.projectCode}-${board.boardName}${suffix}`
                : `${prefix}${board.projectCode}-${board.boardName}`;
              console.log(`[saveCellValue] Fallback legacyBoardId from Boards: ${legacyBoardId}`);
            }
          } catch { /* skip */ }
        }
      }
    } else {
      // Unknown format → passthrough
      writeBoardId = boardId;
      legacyBoardId = undefined;
      console.warn(`[saveCellValue] Unknown boardId format: ${boardId} — passthrough`);
    }

    // ── Realtime publish helper ─────────────────────────────────────────
    const tryPublish = async () => {
      try {
        if (!resolvedProjectCode) return;
        await publishEvent(`board:${resolvedProjectCode}`, 'board.field.updated', {
          projectCode: resolvedProjectCode,
          boardId: originalBoardId,
          entityType,
          fieldType: 'dynamic',
          rowId,
          columnId,
          value: {
            textValue:    values.textValue,
            numberValue:  values.numberValue,
            dateValue:    values.dateValue,
            booleanValue: values.booleanValue,
            fileUrl:      values.fileUrl,
          },
          senderEmail: context.user!.email,
          timestamp: new Date().toISOString(),
        });
      } catch { /* fire and forget */ }
    };

    const isEmpty =
      (!values.textValue  || values.textValue.trim()  === '') &&
      values.numberValue  === undefined &&
      (!values.dateValue  || values.dateValue.trim()  === '') &&
      values.booleanValue === undefined &&
      (!values.fileUrl    || values.fileUrl.trim()    === '');

    const clean = isEmpty ? {} : Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );

    console.log(`[saveCellValue] original=${originalBoardId} writeBoardId=${writeBoardId} legacyBoardId=${legacyBoardId ?? 'none'} rowId=${rowId} colId=${columnId} isEmpty=${isEmpty}`);

    // ── Phase 3: Write cell value ───────────────────────────────────────
    let cellId: string;

    if (isEventsBoard) {
      // Direct legacy write for events- boards (no smartWrite)
      const existing = await CellValues.findOne({ filters: { boardId: writeBoardId, rowId, columnId } });
      if (isEmpty) {
        if (existing) {
          await CellValues.delete({ id: existing.id });
          cellId = existing.id;
          console.log(`[saveCellValue] [events] Deleted id=${existing.id}`);
        } else {
          cellId = '__noop__';
        }
      } else {
        if (existing) {
          await CellValues.update({ id: existing.id, record: clean });
          cellId = existing.id;
          console.log(`[saveCellValue] [events] Updated id=${existing.id}`);
        } else {
          const created = await CellValues.create({ record: { boardId: writeBoardId, rowId, columnId, ...clean } });
          cellId = created.id;
          console.log(`[saveCellValue] [events] Created id=${created.id}`);
        }
      }
    } else {
      // All other boards: smartWriteCellValue (handles UUID/legacy dual-read, move, dedup)
      const result = await smartWriteCellValue({
        uuidBoardId: writeBoardId,
        legacyBoardId,
        rowId,
        columnId,
        values,
        isEmpty,
      });
      cellId = result.id;
      console.log(`[saveCellValue] smartWrite: action=${result.action} boardIdUsed=${result.boardIdUsed}`);
    }

    // ── Phase 4: Sync RecruitmentRows.cellData (recruitment boards only) ─
    if (resolvedBoardType === 'recruitment' || originalBase.startsWith('recruitment-')) {
      try {
        const rowRecord = await RecruitmentRows.findOne({ id: rowId });
        if (rowRecord) {
          resolvedProjectCode = resolvedProjectCode ?? rowRecord.projectCode ?? undefined;
          let cellData: Record<string, unknown> = {};
          try { cellData = JSON.parse(rowRecord.cellData ?? '{}'); } catch { /**/ }
          if (isEmpty) {
            delete cellData[columnId];
          } else {
            cellData[columnId] = clean;
          }
          await RecruitmentRows.update({ id: rowId, record: { cellData: JSON.stringify(cellData) } });
        }
      } catch { /* Non-recruitment rows — ignore */ }
    }

    // ── Phase 5: Sync Tasks (pm boards) ─────────────────────────────────
    if ((originalBase.startsWith('pm-') || resolvedBoardType === 'pm') && !suffix) {
      try {
        const col = await BoardColumns.findOne({ id: columnId });
        if (col?.columnType === 'Fecha') {
          // Find all Fecha columns to determine start vs end — use the column's own boardId first
          const colBoardId = col.boardId || originalBase;
          let colsRes = await BoardColumns.findAll({ filters: { boardId: colBoardId }, limit: 200 });
          let fechaCols = colsRes.records
            .filter(c => !c.deletedAt && c.columnType === 'Fecha')
            .sort((a, b) => (a.columnOrder ?? 9999) - (b.columnOrder ?? 9999));

          // Fallback: if no Fecha cols found and writeBoardId base differs, try that
          const writeBase = writeBoardId.split('::')[0];
          if (fechaCols.length === 0 && writeBase !== colBoardId) {
            colsRes = await BoardColumns.findAll({ filters: { boardId: writeBase }, limit: 200 });
            fechaCols = colsRes.records
              .filter(c => !c.deletedAt && c.columnType === 'Fecha')
              .sort((a, b) => (a.columnOrder ?? 9999) - (b.columnOrder ?? 9999));
          }

          const isStartCol = fechaCols[0]?.id === columnId;
          const isEndCol   = fechaCols[1]?.id === columnId;
          if (isStartCol || isEndCol) {
            const field = isStartCol ? 'startDate' : 'endDate';
            const dateVal = isEmpty ? undefined : (values.dateValue?.split('T')[0] ?? undefined);
            await Tasks.update({ id: rowId, record: { [field]: dateVal } });
            console.log(`[saveCellValue] ✓ Synced Tasks.${field}=${dateVal} for task id=${rowId}`);
          }
        }
      } catch (e) {
        console.log(`[saveCellValue] pm date sync skipped for rowId=${rowId}:`, e);
      }
    }

    // pm: resolve projectCode from Task if still unknown
    if (!resolvedProjectCode && (originalBase.startsWith('pm-') || resolvedBoardType === 'pm')) {
      try {
        const task = await Tasks.findOne({ id: rowId });
        resolvedProjectCode = task?.projectCode ?? undefined;
      } catch { /* skip */ }
    }

    // ── Phase 6: Sync CalendarEvents (cal boards) ───────────────────────
    if ((originalBase.startsWith('cal-') || resolvedBoardType === 'calendar') && !suffix) {
      console.log(`[saveCellValue] Calendar board — checking column for native sync`);
      const calEvent = await CalendarEvents.findOne({ id: rowId });
      resolvedProjectCode = resolvedProjectCode ?? calEvent?.projectCode ?? undefined;

      if (!calEvent) {
        console.warn(`[saveCellValue] CalendarEvents NOT FOUND for rowId=${rowId} — sync skipped`);
      } else {
        try {
          const col = await BoardColumns.findOne({ id: columnId });
          if (col?.columnName) {
            const nativeField = CAL_SYNC_COLUMNS[col.columnName];
            if (nativeField) {
              const update: Partial<{ eventDate: string; durationHours: number; location: string; attendees: string }> = {};

              if (isEmpty) {
                if (nativeField === 'eventDate')     update.eventDate     = undefined;
                if (nativeField === 'durationHours') update.durationHours = undefined;
                if (nativeField === 'location')      update.location      = undefined;
                if (nativeField === 'attendees')     update.attendees     = undefined;
              } else {
                if (nativeField === 'eventDate'     && values.dateValue)                 update.eventDate     = values.dateValue;
                if (nativeField === 'durationHours' && values.numberValue !== undefined) update.durationHours = values.numberValue;
                if (nativeField === 'location'      && values.textValue)                 update.location      = values.textValue;
                if (nativeField === 'attendees'     && values.textValue) {
                  let attendeeName = values.textValue;
                  if (UUID_RE.test(values.textValue)) {
                    try {
                      const uRecord = await Users.findOne({ id: values.textValue });
                      if (uRecord) {
                        attendeeName = [uRecord.firstName, uRecord.lastName].filter(Boolean).join(' ') || uRecord.email || values.textValue;
                      }
                    } catch { /* not a valid user */ }
                  }
                  update.attendees = attendeeName;
                }
              }

              if (Object.keys(update).length > 0) {
                await CalendarEvents.update({ id: rowId, record: update });
                console.log(`[saveCellValue] ✓ CalendarEvents native sync for id=${rowId} field="${nativeField}"`);
              }
            }
          }
        } catch (e) {
          console.warn(`[saveCellValue] cal column sync skipped for columnId=${columnId}:`, e);
        }

        let inviteStatusChanged = false;
        if (
          calEvent.outlookEventId &&
          calEvent.inviteStatus !== 'Cancelado' &&
          calEvent.inviteStatus !== 'Por actualizar'
        ) {
          // Best-effort update with 1 retry — must never crash the endpoint
          try {
            await CalendarEvents.update({ id: rowId, record: { inviteStatus: 'Por actualizar' } });
            inviteStatusChanged = true;
          } catch (firstErr) {
            console.warn(`[saveCellValue] inviteStatus update failed (attempt 1), retrying in 1s:`, firstErr);
            try {
              await new Promise(r => setTimeout(r, 1000));
              await CalendarEvents.update({ id: rowId, record: { inviteStatus: 'Por actualizar' } });
              inviteStatusChanged = true;
            } catch (retryErr) {
              console.warn(`[saveCellValue] inviteStatus update failed (attempt 2), giving up. Cell was saved. Error:`, retryErr);
              inviteStatusChanged = false;
            }
          }
        }

        await tryPublish();
        return { success: true, id: cellId, inviteStatusChanged };
      }
    }

    // ── Phase 7: Publish realtime + return ──────────────────────────────
    await tryPublish();
    return { success: true, id: cellId };
  },
});
