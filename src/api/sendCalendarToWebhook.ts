import { z } from 'zod';
import { createEndpoint, CalendarEvents, Projects, BoardColumns, CellValues, Boards, Documents } from '../../server/compat';

function toKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function mapColType(type: string | null | undefined): string {
  switch (type) {
    case 'Status':        return 'status';
    case 'Fecha':         return 'date';
    case 'Datetime':      return 'datetime';
    case 'Persona':       return 'people';
    case 'Color':         return 'color_picker';
    case 'Texto':         return 'text';
    case 'Número':        return 'numbers';
    case 'Número entero': return 'numbers';
    case 'Select':        return 'dropdown';
    default:              return (type ?? 'text').toLowerCase();
  }
}

function colDefaults(type: string): { width: number; align: string } {
  switch (type) {
    case 'date': case 'datetime': case 'time': return { width: 12, align: 'center' };
    case 'numbers': case 'number':              return { width: 10, align: 'center' };
    case 'status': case 'dropdown':             return { width: 14, align: 'center' };
    case 'people':                              return { width: 14, align: 'left'   };
    default:                                    return { width: 20, align: 'left'   };
  }
}

const FIXED_DEFS = [
  { id: 'dinamica',    key: 'dinamica',    title: 'Dinámica',    type: 'text',   width: 20, align: 'left'   },
  { id: 'fecha',       key: 'fecha',       title: 'Fecha',       type: 'date',   width: 12, align: 'center' },
  { id: 'hora_mx',     key: 'hora_mx',     title: 'Hora (MX)',   type: 'time',   width: 11, align: 'center' },
  { id: 'duracion',    key: 'duracion',    title: 'Duración',    type: 'number', width: 10, align: 'center' },
  { id: 'moderador',   key: 'moderador',   title: 'Moderador',   type: 'text',   width: 14, align: 'left'   },
  { id: 'descripcion', key: 'descripcion', title: 'Descripción', type: 'text',   width: 30, align: 'left'   },
] as const;

const LOGO_URL = 'https://i.ibb.co/pBZgRxSJ/logo-sapience-alargado-timelines-transparente.png';

type ColDef = { id: string; key: string; title: string; type: string; width: number; align: string };

export default createEndpoint({
  authenticated: true,
  description: 'Sends calendar events to n8n webhook with clean columnConfig + groups/rows payload format',
  inputSchema: z.object({
    projectCode: z.string(),
    calendarName: z.string().optional(),
    boardId: z.string().optional(),
    columnOrder: z.array(z.string()).optional(),
    selectedColumnIds: z.array(z.string()).optional(),
    overrideVersion: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    eventCount: z.number(),
    calendarStatus: z.string().optional(),
    fileUrl: z.string().optional(),
    version: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const webhookUrl = process.env.ZITE_N8N_CALENDAR_WEBHOOK_URL ?? '';
    if (!webhookUrl) throw new Error('Webhook URL de calendario no configurada');

    const nowISO = new Date().toISOString();

    // ── Resolve board UUID ─────────────────────────────────────────────────
    let resolvedBoardId: string;
    let boardResult: any = null;

    if (input.boardId) {
      // UUID-first: use boardId exclusively for ALL queries
      resolvedBoardId = input.boardId;
      boardResult = await Boards.findOne({ id: input.boardId });
    } else {
      // Legacy fallback — require calendarName, check for ambiguity
      if (!input.calendarName) throw new Error('Either boardId or calendarName is required.');
      const boardsResult = await Boards.findAll({
        filters: { boardName: input.calendarName, projectCode: input.projectCode, boardType: 'calendar' } as any,
        limit: 10,
      });
      const activeBoards = boardsResult.records.filter(b => !b.deletedAt);
      if (activeBoards.length > 1) {
        throw new Error(`Ambiguity: ${activeBoards.length} calendars named "${input.calendarName}" exist for project ${input.projectCode}. Pass boardId to disambiguate.`);
      }
      if (activeBoards.length === 1) {
        resolvedBoardId = activeBoards[0].id;
        boardResult = activeBoards[0];
      } else {
        // 0 matches — use legacy composite as last resort
        resolvedBoardId = `cal-${input.projectCode}-${input.calendarName}`;
        boardResult = null;
      }
    }

    const groupBoardId = `${resolvedBoardId}::groups`;

    // ── Fetch events: UUID-first, no dual-path when boardId exists ─────────
    const eventsFilter: Record<string, string> = input.boardId
      ? { boardId: input.boardId }
      : { projectCode: input.projectCode, calendarName: input.calendarName! };

    const [eventsResult, projectResult, colRes, cellRes, groupColRes, groupCellRes] = await Promise.all([
      CalendarEvents.findAll({ filters: eventsFilter as any, limit: 500 }),
      Projects.findOne({ filters: { projectCode: input.projectCode } }),
      BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 200 }),
      CellValues.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 2000 }),
      BoardColumns.findAll({ filters: { boardId: groupBoardId } as any, limit: 100 }),
      CellValues.findAll({ filters: { boardId: groupBoardId } as any, limit: 2000 }),
    ]);

    const events      = eventsResult.records;
    const projectName = projectResult?.fullName || input.projectCode;

    // ── Version counter ────────────────────────────────────────────────────
    const newVersion = (boardResult?.calendarVersion ?? 0) + 1;
    const versionStr = input.overrideVersion ?? String(newVersion);

    // ── Active columns & cells ─────────────────────────────────────────────
    const activeCols  = colRes.records.filter(c => !c.deletedAt);
    const activeCells = cellRes.records.filter(c => !c.deletedAt);

    const cellsByEventCol = new Map<string, Map<string, typeof activeCells[0]>>();
    for (const cell of activeCells) {
      if (!cell.rowId || !cell.columnId) continue;
      if (!cellsByEventCol.has(cell.rowId)) cellsByEventCol.set(cell.rowId, new Map());
      cellsByEventCol.get(cell.rowId)!.set(cell.columnId, cell);
    }

    const deduped = new Map<string, typeof activeCols[0]>();
    for (const col of activeCols) {
      deduped.set((col.columnName ?? col.id).toLowerCase().trim(), col);
    }

    // ── Build all column defs ──────────────────────────────────────────────
    const fixedColDefs: ColDef[] = FIXED_DEFS.map(fd => ({ ...fd }));

    const dynColDefs: ColDef[] = [];
    for (const [, col] of deduped) {
      const key  = toKey(col.columnName ?? col.id);
      const type = mapColType(col.columnType);
      const title = col.columnName ?? col.id;
      if (title === 'Ubicación Interna' || title === 'Ubicación (interna)') continue;
      if (type === 'datetime') {
        dynColDefs.push({ id: `${col.id}__fecha`, key: `${key}_fecha`, title: 'Fecha', type: 'date', width: 12, align: 'center' });
        dynColDefs.push({ id: `${col.id}__hora`,  key: `${key}_hora`,  title: 'Hora',  type: 'time', width: 11, align: 'center' });
      } else {
        const def = colDefaults(type);
        dynColDefs.push({ id: col.id, key, title, type, ...def });
      }
    }

    const allDefs: ColDef[] = [...fixedColDefs, ...dynColDefs];

    if (input.columnOrder && input.columnOrder.length > 0) {
      const orderMap = new Map(input.columnOrder.map((id, i) => [id, i]));
      allDefs.sort((a, b) => {
        const ai: number = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : 9999;
        const bi: number = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : 9999;
        return ai - bi;
      });
    }

    // ── Selection ──────────────────────────────────────────────────────────
    const selectedSet = input.selectedColumnIds ? new Set(input.selectedColumnIds) : null;
    const isSelected  = (id: string) => !selectedSet || selectedSet.has(id);

    const columnConfig = allDefs.map((def, i) => ({
      key:     def.key,
      title:   def.title,
      enabled: isSelected(def.id),
      order:   i + 1,
      type:    def.type,
      width:   def.width,
      align:   def.align,
    }));

    const sortedDynDefs = allDefs.filter(d => dynColDefs.some(dd => dd.id === d.id));

    // ── Group membership ───────────────────────────────────────────────────
    const activeGroupCols  = groupColRes.records.filter(c => !c.deletedAt);
    const activeGroupCells = groupCellRes.records.filter(c => !c.deletedAt);
    activeGroupCols.sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

    const eventGroupMap = new Map<string, string>();
    for (const cell of activeGroupCells) {
      if (cell.textValue === '1' && cell.rowId && cell.columnId) {
        if (!eventGroupMap.has(cell.rowId)) eventGroupMap.set(cell.rowId, cell.columnId);
      }
    }

    // ── Build flat row ─────────────────────────────────────────────────────
    function buildRow(ev: typeof events[0]): Record<string, string | number> {
      const eventDate = ev.eventDate ? new Date(ev.eventDate) : null;
      const fecha     = eventDate ? eventDate.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) : '';
      const hora_mx   = eventDate
        ? eventDate.toLocaleTimeString('es-MX', {
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'America/Mexico_City',
          })
        : '';

      const row: Record<string, string | number> = {
        rowId:       ev.id,
        dinamica:    ev.eventName ?? '',
        fecha,
        hora_mx,
        duracion:    ev.durationHours ?? '',
        moderador:   ev.attendees ?? '',
        descripcion: ev.notes ?? '',
      };

      const eventCells = cellsByEventCol.get(ev.id);
      for (const dyn of sortedDynDefs) {
        const isFecha   = dyn.id.endsWith('__fecha');
        const isHora    = dyn.id.endsWith('__hora');
        const realColId = (isFecha || isHora) ? dyn.id.replace(/__fecha$|__hora$/, '') : dyn.id;
        const cell      = eventCells?.get(realColId);
        let val: string | number = '';
        if (cell) {
          if (isFecha || isHora) {
            const rawDate = cell.dateValue;
            if (rawDate) {
              const d = new Date(rawDate);
              val = isFecha
                ? d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
                : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
            }
          } else if (cell.textValue) {
            val = cell.textValue;
          } else if (cell.dateValue) {
            val = new Date(cell.dateValue).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
          } else if (cell.numberValue != null) {
            val = cell.numberValue;
          }
        }
        row[dyn.key] = val;
      }

      return row;
    }

    // ── Bucket events into groups ──────────────────────────────────────────
    const topLevelEvents = events.filter(e => !e.parentEventId);
    const groupBuckets   = new Map<string, typeof events>();
    for (const g of activeGroupCols) groupBuckets.set(g.id, []);
    const ungrouped: typeof events = [];

    for (const e of topLevelEvents) {
      const gid = eventGroupMap.get(e.id);
      if (gid && groupBuckets.has(gid)) groupBuckets.get(gid)!.push(e);
      else ungrouped.push(e);
    }

    const groups: { groupId: string; groupName: string; rows: Record<string, string | number>[] }[] = [];
    for (const g of activeGroupCols) {
      groups.push({
        groupId:   g.id,
        groupName: g.columnName ?? 'Sin nombre',
        rows:      (groupBuckets.get(g.id) ?? []).map(buildRow),
      });
    }
    if (ungrouped.length > 0 || groups.length === 0) {
      groups.push({ groupId: 'ungrouped', groupName: 'Sin grupo', rows: ungrouped.map(buildRow) });
    }

    // ── Payload ────────────────────────────────────────────────────────────
    const calendarLabel = boardResult?.boardName ?? input.calendarName ?? 'Calendar';
    const tematica     = (projectResult as any)?.tematica ?? '';
    const calendarTitle = tematica ? `${tematica} - ${calendarLabel}` : calendarLabel;
    const payload = {
      title:       calendarTitle,
      project:     projectName,
      version:     versionStr,
      last_update: nowISO,
      logo_url:    LOGO_URL,
      columnConfig,
      groups,
    };

    let webhookBody: Record<string, any> = {};
    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const raw = await res.json();
      webhookBody = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
    } catch { /* network error or non-JSON body */ }

    const resolvedFileUrl: string | undefined =
      webhookBody.fileUrl ?? webhookBody.file_url ?? webhookBody.url ??
      webhookBody.webUrl  ?? webhookBody.pdfUrl   ?? undefined;

    // ── Persist version + columns + fileUrl ────────────────────────────────
    if (boardResult?.id) {
      const updates: Record<string, unknown> = { calendarVersion: newVersion };
      if (input.columnOrder || input.selectedColumnIds) {
        updates.excelColumnsJson = JSON.stringify({
          order:    input.columnOrder    ?? allDefs.map(d => d.id),
          selected: input.selectedColumnIds ?? allDefs.map(d => d.id),
        });
      }
      if (resolvedFileUrl) {
        updates.calendarFileUrl = resolvedFileUrl;
      }
      try {
        await Boards.update({ id: boardResult.id, record: updates as any });
      } catch { /* best-effort */ }
    }

    // ── Save document record when we have a fileUrl ────────────────────────
    if (resolvedFileUrl) {
      try {
        const today = new Date().toISOString().split('T')[0];
        await Documents.create({
          record: {
            documentName: `${calendarLabel} - v${versionStr}`,
            projectCode: input.projectCode,
            category: 'Calendario',
            fileUrl: resolvedFileUrl,
            uploadDate: today,
            version: versionStr,
          },
        });
      } catch { /* best-effort */ }
    }

    if (resolvedFileUrl) {
      return { success: true, eventCount: events.length, calendarStatus: 'Listo', fileUrl: resolvedFileUrl, version: versionStr };
    }
    return { success: true, eventCount: events.length, calendarStatus: 'Listo', version: versionStr };
  },
});
