import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues, CalendarAuditLog } from '../../server/compat';
import { publishEvent } from '../lib/ably';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

// Maps native CalendarEvents field → dynamic column name (try these names in order)
const NATIVE_COL_SYNC: Array<{
  inputKey: string;
  colNames: string[];
  valueType: 'date' | 'number' | 'text';
}> = [
  { inputKey: 'eventDate',    colNames: ['Fecha y hora'],                                        valueType: 'date' },
  { inputKey: 'durationHours', colNames: ['Duración (hrs)'],                                     valueType: 'number' },
  { inputKey: 'location',     colNames: ['Ubicación Interna', 'Ubicación (interna)', 'Espacio'], valueType: 'text' },
];

// Dynamic-only fields: stored ONLY as CellValues (not in CalendarEvents table)
const DYN_ONLY_FIELDS: Array<{
  inputKey: string;
  colName: string;
  excludeType?: string;
}> = [
  { inputKey: 'dinamica',             colName: 'Dinámica' },
  { inputKey: 'perfil',               colName: 'Perfil' },
  { inputKey: 'descripcion',          colName: 'Descripción' },
  { inputKey: 'detallesAdicionales',  colName: 'Detalles adicionales' },
  { inputKey: 'detallesAdicionales2', colName: 'Detalles adicionales 2' },
  { inputKey: 'direccion',            colName: 'Ubicación', excludeType: 'Select' },
  { inputKey: 'link',                 colName: 'Link' },
];

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a calendar event, keeping dynamic column CellValues in sync',
  inputSchema: z.object({
    id: z.string().optional(),
    eventName: z.string().optional(),
    projectCode: z.string().optional(),
    calendarName: z.string().optional(),
    boardId: z.string().optional(),
    eventDate: z.string().optional(),
    durationHours: z.number().optional(),
    location: z.string().optional(),
    attendees: z.string().optional(),
    inviteEmails: z.string().optional(),
    inviteSent: z.boolean().optional(),
    notes: z.string().optional(),
    parentEventId: z.string().optional(),
    // Dynamic-only fields (saved as CellValues, not in CalendarEvents)
    dinamica: z.string().optional(),
    perfil: z.string().optional(),
    descripcion: z.string().optional(),
    detallesAdicionales: z.string().optional(),
    detallesAdicionales2: z.string().optional(),
    direccion: z.string().optional(),
    link: z.string().optional(),
    restringirReenvio: z.boolean().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string(), inviteStatusChanged: z.boolean().optional() }),
  execute: async ({ input, context }) => {
    // Strip dynamic-only fields from native record update
    const {
      id,
      dinamica, perfil, descripcion, detallesAdicionales, detallesAdicionales2, direccion, link,
      restringirReenvio,
      ...fields
    } = input;

    let eventId: string;
    let projectCode: string | undefined;
    let calendarName: string | undefined;
    // Track the effective boardId UUID for this event (used for CellValue sync + Ably)
    let effectiveBoardId: string | undefined;
    let inviteStatusChanged = false;
    const isCreate = !id;

    if (id) {
      const ev = await CalendarEvents.findOne({ id });
      projectCode = ev?.projectCode ?? fields.projectCode;
      calendarName = ev?.calendarName ?? fields.calendarName;
      effectiveBoardId = ev?.boardId || input.boardId || undefined;

      const userInputFields = { ...fields };

      if (ev?.outlookEventId && ev?.inviteStatus !== 'Cancelado' && ev?.inviteStatus !== 'Por actualizar' && (fields as any).inviteStatus === undefined) {
        (fields as any).inviteStatus = 'Por actualizar';
        inviteStatusChanged = true;
      }

      await CalendarEvents.update({ id, record: { ...fields, ...(restringirReenvio !== undefined ? { permitirReenvio: restringirReenvio } : {}) } });
      eventId = id;

      // Ably publish — UUID-first for boardId
      try {
        if (projectCode) {
          const ablyBoardId = effectiveBoardId || (calendarName ? `cal-${projectCode}-${calendarName}` : undefined);
          if (ablyBoardId) {
            const updatedFields = Object.fromEntries(
              Object.entries(userInputFields as Record<string, unknown>).filter(
                ([k, v]) => v !== undefined && k !== 'id' && k !== 'projectCode' && k !== 'calendarName'
              )
            );
            if (Object.keys(updatedFields).length > 0) {
              await publishEvent(`board:${projectCode}`, 'board.field.updated', {
                projectCode,
                boardId: ablyBoardId,
                entityType: 'event',
                fieldType: 'fixed',
                rowId: id,
                fields: updatedFields,
                senderEmail: context.user!.email,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      } catch { /* fire and forget */ }
    } else {
      // UUID-first: use input.boardId directly if provided, otherwise fallback to legacy lookup
      let boardIdUUID: string | undefined = input.boardId || undefined;
      if (!boardIdUUID && fields.projectCode && fields.calendarName) {
        const lookup = await lookupBoardUUID(fields.projectCode, fields.calendarName, 'calendar');
        if (lookup.found && lookup.uuid) {
          boardIdUUID = lookup.uuid;
        } else {
          console.warn('[saveCalendarEvent] boardId lookup failed, leaving empty', { projectCode: fields.projectCode, calendarName: fields.calendarName, reason: lookup.reason });
        }
      }
      // Strip boardId from fields to avoid passing it twice (it's set explicitly below)
      const { boardId: _stripBoardId, ...createFields } = fields;
      const record = await CalendarEvents.create({ record: { ...createFields, boardId: boardIdUUID, ...(restringirReenvio !== undefined ? { permitirReenvio: restringirReenvio } : {}) } });
      eventId = record.id;
      projectCode = fields.projectCode;
      calendarName = fields.calendarName;
      effectiveBoardId = boardIdUUID;
    }

    // ── Sync CellValues (native + dynamic-only fields) ───────────────────────
    const nativeFieldsToSync = NATIVE_COL_SYNC.filter(({ inputKey }) => (fields as any)[inputKey] !== undefined);
    const dynFieldsToSync = DYN_ONLY_FIELDS.filter(({ inputKey }) => (input as any)[inputKey] !== undefined);
    const needsSync = nativeFieldsToSync.length > 0 || dynFieldsToSync.length > 0;

    if (needsSync && (effectiveBoardId || (projectCode && calendarName))) {
      // ── Resolve boardId for CellValue/BoardColumn writes ───────────
      let resolvedBoardId: string;
      let resolvedLegacyId: string | undefined;

      if (effectiveBoardId) {
        // UUID available — use directly, but still compute legacy for dual-read in smartWrite
        resolvedBoardId = effectiveBoardId;
        resolvedLegacyId = (projectCode && calendarName) ? `cal-${projectCode}-${calendarName}` : undefined;
      } else {
        // Legacy path
        const legacyBoardId = `cal-${projectCode}-${calendarName}`;
        resolvedBoardId = legacyBoardId;
        resolvedLegacyId = legacyBoardId;
        try {
          const resolution = await resolveWriteBoardId(legacyBoardId, {
            projectCode: projectCode!,
            boardName: calendarName!,
            boardType: 'calendar',
          });
          resolvedBoardId = resolution.writeBoardId;
          resolvedLegacyId = resolution.legacyBoardId ?? legacyBoardId;
          if (resolution.reason === 'legacy-fallback' || resolution.reason === 'input-passthrough') {
            console.warn('[saveCalendarEvent] UUID not found, using legacy boardId', { legacyBoardId, reason: resolution.reason });
          }
        } catch (err) {
          console.warn('[saveCalendarEvent] resolveWriteBoardId failed, using legacy', { legacyBoardId, error: String(err) });
        }
      }

      // ── BoardColumns read: UUID-first, legacy fallback only when needed
      let cols = (await BoardColumns.findAll({ filters: { boardId: resolvedBoardId }, limit: 100 })).records;
      if (cols.length === 0 && resolvedLegacyId && resolvedLegacyId !== resolvedBoardId) {
        cols = (await BoardColumns.findAll({ filters: { boardId: resolvedLegacyId }, limit: 100 })).records;
      }

      // Extra legacy fallback: try cal-{projectCode}-{calendarName} if cols still empty
      if (cols.length === 0 && effectiveBoardId && projectCode && calendarName) {
        const legacyFallbackId = `cal-${projectCode}-${calendarName}`;
        if (legacyFallbackId !== resolvedBoardId) {
          cols = (await BoardColumns.findAll({ filters: { boardId: legacyFallbackId }, limit: 100 })).records;
          if (cols.length > 0) {
            console.warn('[saveCalendarEvent] CellValue columns found under legacy boardId fallback', { legacyFallbackId, effectiveBoardId, eventId });
          }
        }
      }

      // Diagnostic: warn if no columns found at all
      if (cols.length === 0) {
        console.warn('[saveCalendarEvent] CellValue sync skipped: no matching columns found', { eventId, resolvedBoardId, effectiveBoardId, projectCode, calendarName });
      }

      // Sync native fields (eventDate, durationHours, location) via smartWriteCellValue
      for (const { inputKey, colNames, valueType } of nativeFieldsToSync) {
        const col = cols.find(c => colNames.includes(c.columnName ?? ''));
        if (!col) continue;
        const nativeValue = (fields as Record<string, unknown>)[inputKey];
        const isEmpty = nativeValue === null || nativeValue === undefined || nativeValue === '';
        const values: Record<string, unknown> = {};
        if (!isEmpty) {
          if (valueType === 'date') values.dateValue = nativeValue as string;
          else if (valueType === 'number') values.numberValue = nativeValue as number;
          else values.textValue = String(nativeValue);
        }
        await smartWriteCellValue({
          uuidBoardId: resolvedBoardId,
          legacyBoardId: resolvedLegacyId,
          rowId: eventId,
          columnId: col.id,
          values: values as any,
          isEmpty,
        });
      }

      // Sync dynamic-only fields via smartWriteCellValue
      for (const { inputKey, colName, excludeType } of dynFieldsToSync) {
        const col = cols.find(c => c.columnName === colName && (!excludeType || c.columnType !== excludeType));
        if (!col) continue;
        const value = (input as any)[inputKey];
        const isEmpty = !value;
        await smartWriteCellValue({
          uuidBoardId: resolvedBoardId,
          legacyBoardId: resolvedLegacyId,
          rowId: eventId,
          columnId: col.id,
          values: isEmpty ? {} : { textValue: String(value) },
          isEmpty,
        });
      }
    }

    // ── Reverse sync on CREATE without eventDate ──────────────────────────────
    if (isCreate && fields.eventDate === undefined && (effectiveBoardId || (projectCode && calendarName))) {
      (async () => {
        try {
          let rsResolvedId: string;
          let rsLegacyId: string | undefined;

          if (effectiveBoardId) {
            // UUID available — use directly, but still compute legacy for dual-read
            rsResolvedId = effectiveBoardId;
            rsLegacyId = (projectCode && calendarName) ? `cal-${projectCode}-${calendarName}` : undefined;
          } else {
            const legacyBoardId = `cal-${projectCode}-${calendarName}`;
            rsResolvedId = legacyBoardId;
            rsLegacyId = legacyBoardId;
            try {
              const resolution = await resolveWriteBoardId(legacyBoardId, {
                projectCode: projectCode!,
                boardName: calendarName!,
                boardType: 'calendar',
              });
              rsResolvedId = resolution.writeBoardId;
              rsLegacyId = resolution.legacyBoardId ?? legacyBoardId;
            } catch { /* use legacy */ }
          }

          // Read BoardColumns
          let cols = (await BoardColumns.findAll({ filters: { boardId: rsResolvedId }, limit: 100 })).records;
          if (cols.length === 0 && rsLegacyId && rsLegacyId !== rsResolvedId) {
            cols = (await BoardColumns.findAll({ filters: { boardId: rsLegacyId }, limit: 100 })).records;
          }

          const backfill: Partial<{ eventDate: string; durationHours: number; location: string }> = {};

          const dateCol = cols.find(c => c.columnName === 'Fecha y hora');
          const durCol  = cols.find(c => c.columnName === 'Duración (hrs)');
          const locCol  = cols.find(c => ['Ubicación Interna', 'Ubicación (interna)', 'Espacio'].includes(c.columnName ?? ''));

          // Cell read helper
          const findCell = async (columnId: string) => {
            let cell = await CellValues.findOne({ filters: { boardId: rsResolvedId, rowId: eventId, columnId } });
            if (!cell && rsLegacyId && rsLegacyId !== rsResolvedId) {
              cell = await CellValues.findOne({ filters: { boardId: rsLegacyId, rowId: eventId, columnId } });
            }
            return cell;
          };

          if (dateCol) {
            const cell = await findCell(dateCol.id);
            if (cell?.dateValue) backfill.eventDate = cell.dateValue;
          }
          if (durCol) {
            const cell = await findCell(durCol.id);
            if (cell?.numberValue != null) backfill.durationHours = cell.numberValue;
          }
          if (locCol) {
            const cell = await findCell(locCol.id);
            if (cell?.textValue) backfill.location = cell.textValue;
          }
          if (Object.keys(backfill).length > 0) {
            await CalendarEvents.update({ id: eventId, record: backfill });
          }
        } catch (err) {
          console.error(`[saveCalendarEvent] Reverse sync failed for id=${eventId}:`, (err as Error)?.message ?? err);
        }
      })();
    }

    // Write audit log (fire-and-forget)
    const action = isCreate ? 'Evento creado' : 'Evento actualizado';
    CalendarAuditLog.create({
      record: {
        action,
        eventName: fields.eventName ?? (isCreate ? '(sin nombre)' : undefined),
        calendarName: calendarName ?? '',
        projectCode: projectCode ?? '',
        userEmail: context.user!.email,
        userName: [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email,
        timestamp: new Date().toISOString(),
        details: isCreate
          ? `Nuevo evento creado con ID: ${eventId}`
          : `Campos actualizados: ${Object.keys({ ...fields, ...(dinamica !== undefined ? { dinamica } : {}), ...(perfil !== undefined ? { perfil } : {}) }).join(', ')} | ID: ${eventId}`,
      },
    }).catch(err => console.error('[CalendarAuditLog] Failed to write save log:', err));

    return { success: true, id: eventId, inviteStatusChanged: inviteStatusChanged || undefined };
  },
});
