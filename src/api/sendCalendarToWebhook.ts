import { z } from 'zod';
import { createEndpoint, CalendarEvents, Projects, BoardColumns, CellValues, Boards, Documents } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';
import { buildCalendarExcelBuffer } from '../serverUtils/calendarExcelBuilder';

// El link de Teams ya trae todo lo que Graph necesita para resolver drive/carpeta —
// mismo parseo que ya usa getProjectTeamsFiles.ts (formato confirmado en vivo):
//   https://teams.microsoft.com/l/channel/{channelId}/{nombre}?groupId={teamId}&tenantId=...
function parseChannelUrl(url: string): { teamId: string; channelId: string } | null {
  try {
    const u = new URL(url);
    const teamId = u.searchParams.get('groupId');
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('channel');
    const channelId = idx >= 0 ? decodeURIComponent(parts[idx + 1] ?? '') : null;
    if (!teamId || !channelId) return null;
    return { teamId, channelId };
  } catch {
    return null;
  }
}

const CALENDARIOS_FOLDER = 'CALENDARIOS';

/** Sube el .xlsx a la carpeta CALENDARIOS del canal de Teams del proyecto (misma carpeta
 * que ya crea createTeamsChannel.ts) y devuelve el webUrl. Crea la carpeta si no existe
 * — canales creados antes de que CALENDARIOS estuviera en FOLDER_NAMES no la tendrían. */
async function uploadCalendarExcelToSharePoint(channelUrl: string, filename: string, buffer: Buffer): Promise<string> {
  const parsed = parseChannelUrl(channelUrl);
  if (!parsed) throw new Error('No se pudo interpretar el link del canal de Teams');

  const folderRes = await graphFetch(`https://graph.microsoft.com/v1.0/teams/${parsed.teamId}/channels/${parsed.channelId}/filesFolder`);
  if (!folderRes.ok) throw new Error(`Graph respondió ${folderRes.status} obteniendo la carpeta del canal`);
  const root = await folderRes.json() as { id: string; parentReference?: { driveId?: string } };
  const driveId = root.parentReference?.driveId;
  if (!driveId) throw new Error('La carpeta del canal no trae driveId');

  const childrenRes = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children?$top=200`);
  if (!childrenRes.ok) throw new Error(`Graph respondió ${childrenRes.status} listando las carpetas del canal`);
  const children = (await childrenRes.json()).value as Array<{ id: string; name: string; folder?: unknown }>;
  let calendariosId = children.find(c => c.folder && c.name === CALENDARIOS_FOLDER)?.id;

  if (!calendariosId) {
    const createRes = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children`, {
      method: 'POST',
      body: JSON.stringify({ name: CALENDARIOS_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    });
    if (!createRes.ok) throw new Error(`No se pudo crear la carpeta ${CALENDARIOS_FOLDER} (${createRes.status})`);
    calendariosId = (await createRes.json() as { id: string }).id;
  }

  const safeName = encodeURIComponent(filename);
  const uploadRes = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${calendariosId}:/${safeName}:/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: buffer,
    },
  );
  if (!uploadRes.ok) throw new Error(`Graph respondió ${uploadRes.status} subiendo el archivo`);
  const uploaded = await uploadRes.json() as { webUrl?: string };
  if (!uploaded.webUrl) throw new Error('Graph no devolvió una URL para el archivo subido');
  return uploaded.webUrl;
}

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

type ColDef = { id: string; key: string; title: string; type: string; width: number; align: string; optionsJson?: string | null };

export default createEndpoint({
  authenticated: true,
  description: 'Genera el Excel de calendario (masthead, grupos con color, dropdown de Status) en el backend y lo sube a SharePoint vía Graph — ya no depende de n8n',
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
    excelBase64: z.string().optional(),
  }),
  execute: async ({ input }) => {
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

    const events = eventsResult.records;

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
        dynColDefs.push({ id: col.id, key, title, type, ...def, optionsJson: col.optionsJson ?? null });
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

    // ── Título + fecha (se conservan aunque ya no se manden a n8n) ──────────
    const calendarLabel = boardResult?.boardName ?? input.calendarName ?? 'Calendar';
    const tematica     = (projectResult as any)?.tematica ?? '';
    const calendarTitle = tematica ? `${tematica} - ${calendarLabel}` : calendarLabel;

    // ── Construir el .xlsx con el diseño nuevo (masthead, grupos con su color
    // real, dropdown + código de color en Status) — 100% en el backend, ya sin
    // depender de n8n para generar el archivo. ──────────────────────────────
    const visibleColumns = allDefs
      .filter(d => isSelected(d.id))
      .map(d => ({ key: d.key, title: d.title, type: d.type, align: d.align, optionsJson: d.optionsJson ?? null }));

    const excelGroups = groups.map(g => ({
      groupId: g.groupId,
      groupName: g.groupName,
      colorId: g.groupId === 'ungrouped' ? null : (activeGroupCols.find(c => c.id === g.groupId)?.columnType ?? null),
      rows: g.rows,
    }));

    const excelBuffer = await buildCalendarExcelBuffer({
      calendarTitle,
      version: versionStr,
      columns: visibleColumns,
      groups: excelGroups,
    });
    const excelBase64 = excelBuffer.toString('base64');

    // ── Subir a SharePoint vía Graph (misma carpeta CALENDARIOS que ya usa
    // createTeamsChannel.ts) — best-effort: si el proyecto no tiene canal de
    // Teams vinculado o Graph falla, el archivo se genera igual y se manda por
    // excelBase64 para descarga directa; solo se pierde la copia en SharePoint. ──
    let resolvedFileUrl: string | undefined;
    const channelUrl = (projectResult as any)?.teamsChannelUrl as string | undefined;
    if (projectResult && (projectResult as any).teamsChannelStatus === 'Listo' && channelUrl) {
      try {
        resolvedFileUrl = await uploadCalendarExcelToSharePoint(channelUrl, `${calendarTitle} - V${versionStr}.xlsx`, excelBuffer);
      } catch (e) {
        console.log('No se pudo subir el calendario a SharePoint:', e);
      }
    }

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

    return { success: true, eventCount: events.length, calendarStatus: 'Listo', fileUrl: resolvedFileUrl, version: versionStr, excelBase64 };
  },
});
