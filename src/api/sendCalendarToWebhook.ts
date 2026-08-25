import { z } from 'zod';
import { createEndpoint, Boards, Documents } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';
import { buildCalendarExcelBuffer } from '../serverUtils/calendarExcelBuilder';
import { fetchCalendarExcelData } from '../serverUtils/calendarExcelData';

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
    const { boardResult, projectResult, calendarTitle, allDefs, groups, eventCount } = await fetchCalendarExcelData({
      projectCode: input.projectCode,
      calendarName: input.calendarName,
      boardId: input.boardId,
    });

    // ── Version counter ────────────────────────────────────────────────────
    const newVersion = (boardResult?.calendarVersion ?? 0) + 1;
    const versionStr = input.overrideVersion ?? String(newVersion);
    const calendarLabel = boardResult?.boardName ?? input.calendarName ?? 'Calendar';

    // ── Orden + selección de columnas (decisión del diálogo, no del fetch) ──
    if (input.columnOrder && input.columnOrder.length > 0) {
      const orderMap = new Map(input.columnOrder.map((id, i) => [id, i]));
      allDefs.sort((a, b) => {
        const ai: number = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : 9999;
        const bi: number = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : 9999;
        return ai - bi;
      });
    }
    const selectedSet = input.selectedColumnIds ? new Set(input.selectedColumnIds) : null;
    const isSelected  = (id: string) => !selectedSet || selectedSet.has(id);

    // ── Construir el .xlsx con el diseño nuevo (masthead, grupos con su color
    // real, dropdown + código de color en Status) — 100% en el backend, ya sin
    // depender de n8n para generar el archivo. ──────────────────────────────
    const visibleColumns = allDefs
      .filter(d => isSelected(d.id))
      .map(d => ({ key: d.key, title: d.title, type: d.type, align: d.align, optionsJson: d.optionsJson ?? null }));

    const excelBuffer = await buildCalendarExcelBuffer({
      calendarTitle,
      version: versionStr,
      columns: visibleColumns,
      groups,
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

    return { success: true, eventCount, calendarStatus: 'Listo', fileUrl: resolvedFileUrl, version: versionStr, excelBase64 };
  },
});
