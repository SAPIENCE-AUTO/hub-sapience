import { z } from 'zod';
import { createEndpoint, Tasks, Projects, BoardColumns, CellValues, Documents, Boards } from '../../server/compat';
import { buildSapienceDocumentName } from '../serverUtils/documentNaming';
import { uploadFileToTeamsChannel } from '../serverUtils/teamsFileUpload';

const TIMELINE_FOLDER = 'TIMELINE';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Convert HSL (0-360, 0-100, 0-100) to hex string
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

// Color ID → [h, s, l] from CSS variables in index.css
const COLOR_HSL: Record<string, [number, number, number]> = {
  'red-1':    [4,   85, 65], 'red-2':    [4,   85, 55], 'red-3':    [4,   82, 45], 'red-4':    [4,   78, 37], 'red-5':    [4,   72, 28],
  'orange-1': [25,  90, 65], 'orange-2': [25,  88, 55], 'orange-3': [25,  85, 45], 'orange-4': [25,  82, 37], 'orange-5': [25,  78, 28],
  'yellow-1': [47,  95, 62], 'yellow-2': [47,  92, 52], 'yellow-3': [47,  88, 43], 'yellow-4': [47,  84, 35], 'yellow-5': [47,  78, 27],
  'green-1':  [142, 52, 60], 'green-2':  [142, 56, 50], 'green-3':  [142, 58, 40], 'green-4':  [142, 56, 32], 'green-5':  [142, 52, 24],
  'blue-1':   [215, 82, 68], 'blue-2':   [215, 80, 58], 'blue-3':   [215, 78, 48], 'blue-4':   [215, 76, 38], 'blue-5':   [215, 72, 29],
  'purple-1': [265, 68, 68], 'purple-2': [265, 70, 58], 'purple-3': [265, 68, 48], 'purple-4': [265, 65, 38], 'purple-5': [265, 62, 29],
  // Legacy backward-compat IDs
  chart1: [215, 80, 58], chart2: [142, 56, 50], chart3: [25, 85, 45],
  chart4: [265, 70, 58], chart5: [199, 80, 52], primary: [215, 78, 48],
  destructive: [4, 82, 45], muted: [215, 15, 50],
  'group-pink': [4, 85, 65], 'group-yellow': [47, 92, 52], 'group-lime': [84, 58, 44],
  'group-teal': [174, 58, 40], 'group-indigo': [239, 68, 52], 'group-amber': [35, 88, 50],
  'group-rose': [4, 85, 55], 'group-emerald': [152, 58, 42], 'group-sky': [199, 80, 52],
  'group-violet': [262, 68, 52], 'group-fuchsia': [293, 68, 50], 'group-slate': [215, 18, 50],
};

function colorIdToHex(colorId: string | null | undefined): string {
  if (!colorId) return '#6B7280';
  const hsl = COLOR_HSL[colorId];
  return hsl ? hslToHex(...hsl) : '#6B7280';
}

interface GanttTask { name: string; start: string; end: string; color?: string | null }
interface GanttGroup { name: string; tasks: GanttTask[]; header_color?: string }

export default createEndpoint({
  authenticated: true,
  description: 'Genera el Excel de Timeline llamando directo a gantt-service (Render) y lo sube a Teams vía Graph — ya no depende de n8n',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string().optional(),
    boardId: z.string().optional(),
    version: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    taskCount: z.number(),
    timelineStatus: z.string().optional(),
    fileUrl: z.string().optional(),
    version: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const ganttServiceUrl = (process.env.GANTT_SERVICE_URL ?? '').replace(/\/$/, '');
    if (!ganttServiceUrl) throw new Error('GANTT_SERVICE_URL no configurada');

    // ── Resolve board identity: UUID-first, legacy fallback ────────────────
    let resolvedBoardId: string;
    let boardRecord: any = null;

    if (input.boardId) {
      // UUID path — use directly, no name-based lookup
      resolvedBoardId = input.boardId;
      boardRecord = await Boards.findOne({ id: input.boardId });
    } else if (input.boardName) {
      // Legacy fallback with ambiguity check
      const { records: matchingBoards } = await Boards.findAll({
        filters: { boardName: input.boardName, projectCode: input.projectCode, boardType: 'pm' } as any,
        limit: 10,
      });
      const activeBoards = matchingBoards.filter(b => !b.deletedAt);
      if (activeBoards.length > 1) {
        throw new Error(`Ambiguity: ${activeBoards.length} active boards named "${input.boardName}" in project ${input.projectCode}. Pass boardId to resolve.`);
      }
      if (activeBoards.length === 1) {
        resolvedBoardId = activeBoards[0].id;
        boardRecord = activeBoards[0];
      } else {
        // Zero matches — backward-compat legacy composite
        resolvedBoardId = `pm-${input.projectCode}-${input.boardName}`;
      }
    } else {
      resolvedBoardId = `pm-${input.projectCode}`;
    }

    const boardId      = resolvedBoardId;
    const groupBoardId = `${boardId}::groups`;

    // Build task filters: prefer boardId when UUID, fallback to boardName
    const taskFilters: Record<string, any> = { projectCode: input.projectCode };
    if (input.boardId) {
      taskFilters.boardId = input.boardId;
    } else if (input.boardName) {
      taskFilters.boardName = input.boardName;
    }

    // Fetch everything in parallel
    const [tasksResult, projectResult, colRes, cellRes, groupColRes, groupCellRes] = await Promise.all([
      Tasks.findAll({ filters: taskFilters as any, limit: 500 }),
      Projects.findOne({ filters: { projectCode: input.projectCode } }),
      BoardColumns.findAll({ filters: { boardId } as any, limit: 200 }),
      CellValues.findAll({ filters: { boardId } as any, limit: 2000 }),
      BoardColumns.findAll({ filters: { boardId: groupBoardId } as any, limit: 100 }),
      CellValues.findAll({ filters: { boardId: groupBoardId } as any, limit: 2000 }),
    ]);

    // ── Version counter ───────────────────────────────────────────────────
    const autoVersion = (boardRecord?.timelineVersion ?? 0) + 1;
    const versionStr  = input.version ?? String(autoVersion);

    const tasks       = tasksResult.records.filter(t => !t.deletedAt);

    // Build title: "{tematica} - {boardName}" or just "{boardName}" if no tematica
    const tematica    = (projectResult as any)?.tematica ?? '';
    const boardLabel  = input.boardName ?? 'Timeline';
    const titleStr    = tematica ? `${tematica} - ${boardLabel}` : boardLabel;

    // ── Task columns & cells ────────────────────────────────────────────────
    const activeCols  = colRes.records.filter(c => !c.deletedAt);
    const activeCells = cellRes.records.filter(c => !c.deletedAt);

    // taskId -> { columnId -> cell }
    const cellsByTaskCol = new Map<string, Map<string, typeof activeCells[0]>>();
    for (const cell of activeCells) {
      if (!cell.rowId || !cell.columnId) continue;
      if (!cellsByTaskCol.has(cell.rowId)) cellsByTaskCol.set(cell.rowId, new Map());
      cellsByTaskCol.get(cell.rowId)!.set(cell.columnId, cell);
    }

    // Group columns by normalised name to handle duplicates
    const colsByName = new Map<string, typeof activeCols>();
    for (const col of activeCols) {
      const key = (col.columnName ?? '').toLowerCase().trim();
      if (!colsByName.has(key)) colsByName.set(key, []);
      colsByName.get(key)!.push(col);
    }

    function resolveCell(taskId: string, colName: string) {
      const cols = colsByName.get(colName.toLowerCase().trim()) ?? [];
      const taskCells = cellsByTaskCol.get(taskId);
      if (!taskCells) return undefined;
      for (const col of cols) {
        const cell = taskCells.get(col.id);
        if (cell) return cell;
      }
      return undefined;
    }

    // Deduped columns (last one wins on duplicate names) — solo hace falta ya
    // para encontrar la columna "Color" por tipo cuando no se llama literal "Color".
    const deduped = new Map<string, typeof activeCols[0]>();
    for (const col of activeCols) {
      deduped.set((col.columnName ?? col.id).toLowerCase().trim(), col);
    }

    // ── Group columns & membership ──────────────────────────────────────────
    const activeGroupCols  = groupColRes.records.filter(c => !c.deletedAt);
    const activeGroupCells = groupCellRes.records.filter(c => !c.deletedAt);

    // Sort groups by their column order
    activeGroupCols.sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

    // taskId -> groupColumnId (first group with textValue === '1')
    const taskGroupMap = new Map<string, string>();
    for (const cell of activeGroupCells) {
      if (cell.textValue === '1' && cell.rowId && cell.columnId) {
        if (!taskGroupMap.has(cell.rowId)) {
          taskGroupMap.set(cell.rowId, cell.columnId);
        }
      }
    }

    // ── Build a gantt-service task from a Hub task ──────────────────────────
    // gantt-service exige start/end (no acepta vacío) — una tarea sin ninguna
    // fecha no se puede dibujar como barra, se omite del Gantt en vez de
    // tronar la generación de todo el archivo.
    function toGanttTask(t: typeof tasks[0]): GanttTask | null {
      const startCell = resolveCell(t.id, 'Inicio');
      const endCell   = resolveCell(t.id, 'Fin');
      const colorColByType = Array.from(deduped.values()).find(c => c.columnType === 'Color');
      const colorCell = resolveCell(t.id, 'Color') ??
        (colorColByType ? cellsByTaskCol.get(t.id)?.get(colorColByType.id) : undefined);

      const startDate = startCell?.dateValue?.split('T')[0] || t.startDate?.split('T')[0] || '';
      const endDate   = endCell?.dateValue?.split('T')[0]   || t.endDate?.split('T')[0]   || '';
      if (!startDate && !endDate) return null;

      return {
        name: t.taskName ?? '',
        start: startDate || endDate,
        end: endDate || startDate,
        color: colorCell?.textValue || null,
      };
    }

    // ── Bucket tasks into groups ────────────────────────────────────────────
    const topLevelTasks = tasks.filter(t => !t.parentTaskId);

    const groupBuckets = new Map<string, typeof tasks>();
    for (const g of activeGroupCols) groupBuckets.set(g.id, []);
    const ungrouped: typeof tasks = [];

    for (const t of topLevelTasks) {
      const gid = taskGroupMap.get(t.id);
      if (gid && groupBuckets.has(gid)) {
        groupBuckets.get(gid)!.push(t);
      } else {
        ungrouped.push(t);
      }
    }

    // ── Helper: resolve a task's start date for chronological sorting ──────
    const getTaskStartDate = (t: typeof tasks[0]): string =>
      resolveCell(t.id, 'Inicio')?.dateValue?.split('T')[0] || t.startDate?.split('T')[0] || '';

    const sortByStartDate = (arr: typeof tasks) =>
      [...arr].sort((a, b) => {
        const da = getTaskStartDate(a);
        const db = getTaskStartDate(b);
        if (!da && !db) return 0;
        if (!da) return 1;   // tasks without date go last
        if (!db) return -1;
        return da < db ? -1 : da > db ? 1 : 0;
      });

    // ── Build groups array for gantt-service ────────────────────────────────
    // Ungrouped primero (con header en blanco, gris — mismo criterio visual
    // que ya tenía el flujo viejo), luego los grupos con nombre en su orden.
    const ganttGroups: GanttGroup[] = [];

    if (ungrouped.length > 0 || activeGroupCols.length === 0) {
      ganttGroups.push({
        name: ' ',
        header_color: '#6B7280',
        tasks: sortByStartDate(ungrouped).map(toGanttTask).filter((t): t is GanttTask => t !== null),
      });
    }

    for (const g of activeGroupCols) {
      const bucket = groupBuckets.get(g.id) ?? [];
      ganttGroups.push({
        name: g.columnName ?? 'Sin nombre',
        header_color: colorIdToHex(g.columnType ?? null),
        tasks: sortByStartDate(bucket).map(toGanttTask).filter((t): t is GanttTask => t !== null),
      });
    }

    // Nombre completo ("PROYECTO - temática - Sapience - nombre y versión")
    // para el archivo en Teams/SharePoint — mismo criterio que ya usa el
    // Excel de Calendario (sendCalendarToWebhook.ts).
    const fileName = `${buildSapienceDocumentName({ projectCode: input.projectCode, tematica, docLabel: `${boardLabel} - V${versionStr}` })}.xlsx`;

    try {
      // ── Generar el .xlsx llamando directo a gantt-service (Render) ───────
      const ganttRes = await fetch(`${ganttServiceUrl}/gantt-xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleStr,
          groups: ganttGroups,
          logo_url: 'https://i.postimg.cc/hjCKc6D1/logo-sapience-transparente.png',
          version_info: versionStr,
          file_name: fileName,
        }),
      });
      if (!ganttRes.ok) {
        const errText = await ganttRes.text().catch(() => '');
        throw new Error(`gantt-service respondió ${ganttRes.status}: ${errText}`);
      }
      const excelBuffer = Buffer.from(await ganttRes.arrayBuffer());

      // ── Subir a SharePoint vía Graph (carpeta TIMELINE del canal) —
      // best-effort: si el proyecto no tiene canal vinculado o Graph falla,
      // el timeline se generó igual, solo se pierde la copia en SharePoint. ──
      let resolvedFileUrl: string | undefined;
      const channelUrl = (projectResult as any)?.teamsChannelUrl as string | undefined;
      if (projectResult && (projectResult as any).teamsChannelStatus === 'Listo' && channelUrl) {
        try {
          resolvedFileUrl = await uploadFileToTeamsChannel(channelUrl, TIMELINE_FOLDER, fileName, excelBuffer, XLSX_CONTENT_TYPE);
        } catch (e) {
          console.log('No se pudo subir el timeline a SharePoint:', e);
        }
      }

      const updatedAt = new Date().toISOString();

      if (projectResult?.id) {
        // timelineUrl solo se agrega si de verdad hay uno — mandarlo como
        // `undefined` explícito se vuelve NULL en el UPDATE (mismo bug que ya
        // se corrigió en saveProject.ts) y borraría la URL de una subida
        // anterior cada vez que esta subida en particular fallara.
        const updateFields: Record<string, unknown> = { timelineStatus: 'Listo', timelineUpdatedAt: updatedAt };
        if (resolvedFileUrl) updateFields.timelineUrl = resolvedFileUrl;
        try { await Projects.update({ id: projectResult.id, record: updateFields }); } catch { /* best-effort */ }
      }

      if (resolvedFileUrl) {
        try {
          const today = new Date().toISOString().split('T')[0];
          await Documents.create({
            record: {
              documentName: `${boardLabel} - ${input.projectCode}`,
              projectCode: input.projectCode,
              category: 'Timeline',
              fileUrl: resolvedFileUrl,
              uploadDate: today,
            },
          });
        } catch { /* best-effort */ }
      }

      if (boardRecord?.id) {
        try { await Boards.update({ id: boardRecord.id, record: { timelineVersion: autoVersion } as any }); } catch { /* best-effort */ }
      }

      return { success: true, taskCount: tasks.length, timelineStatus: 'Listo', fileUrl: resolvedFileUrl, version: versionStr };
    } catch (err) {
      if (projectResult?.id) {
        try { await Projects.update({ id: projectResult.id, record: { timelineStatus: 'Error', timelineUpdatedAt: new Date().toISOString() } }); } catch { /* best-effort */ }
      }
      throw err;
    }
  },
});
