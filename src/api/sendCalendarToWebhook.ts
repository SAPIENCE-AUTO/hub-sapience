import { z } from 'zod';
import { createEndpoint, Boards, Documents } from '../../server/compat';
import { buildCalendarExcelBuffer } from '../serverUtils/calendarExcelBuilder';
import { fetchCalendarExcelData } from '../serverUtils/calendarExcelData';
import { buildSapienceDocumentName } from '../serverUtils/documentNaming';
import { uploadFileToTeamsChannel } from '../serverUtils/teamsFileUpload';

const CALENDARIOS_FOLDER = 'CALENDARIOS';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
        // Nomenclatura completa en SharePoint: "PROYECTO - temática - Sapience -
        // nombre y versión" — calendarTitle (temática + nombre del tablero) sigue
        // siendo el masthead DENTRO del Excel, esto es solo el nombre del archivo.
        const tematica = (projectResult as any)?.tematica ?? '';
        const fileName = `${buildSapienceDocumentName({ projectCode: input.projectCode, tematica, docLabel: `${calendarLabel} - V${versionStr}` })}.xlsx`;
        resolvedFileUrl = await uploadFileToTeamsChannel(channelUrl, CALENDARIOS_FOLDER, fileName, excelBuffer, XLSX_CONTENT_TYPE);
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
