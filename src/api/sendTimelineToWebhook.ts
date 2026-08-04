import { z } from 'zod';
import { createEndpoint, Tasks, Projects, BoardColumns, CellValues, Documents, Users, Boards } from 'zite-integrations-backend-sdk';

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

// Map internal column types to monday.com-compatible types
function mapColType(type: string | null | undefined): string {
  switch (type) {
    case 'Status':        return 'status';
    case 'Fecha':         return 'date';
    case 'Persona':       return 'people';
    case 'Color':         return 'color_picker';
    case 'Texto':         return 'text';
    case 'Número':        return 'numbers';
    case 'Número entero': return 'numbers';
    default:              return (type ?? 'text').toLowerCase();
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Sends project tasks grouped by group to n8n webhook for timeline/Excel generation',
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
    const webhookUrl = process.env.ZITE_N8N_TIMELINE_WEBHOOK_URL ?? '';
    if (!webhookUrl) throw new Error('Webhook URL not configured');

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
    const [tasksResult, projectResult, colRes, cellRes, groupColRes, groupCellRes, usersResult] = await Promise.all([
      Tasks.findAll({ filters: taskFilters as any, limit: 500 }),
      Projects.findOne({ filters: { projectCode: input.projectCode } }),
      BoardColumns.findAll({ filters: { boardId } as any, limit: 200 }),
      CellValues.findAll({ filters: { boardId } as any, limit: 2000 }),
      BoardColumns.findAll({ filters: { boardId: groupBoardId } as any, limit: 100 }),
      CellValues.findAll({ filters: { boardId: groupBoardId } as any, limit: 2000 }),
      Users.findAll({ limit: 200, fields: ['firstName', 'lastName', 'email'] }),
    ]);

    // ── Version counter ───────────────────────────────────────────────────
    const autoVersion = (boardRecord?.timelineVersion ?? 0) + 1;
    const versionStr  = input.version ?? String(autoVersion);

    // Build ID→name map for resolving Persona cell values
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userById = new Map(usersResult.records.map(u => [u.id, u]));
    const resolvePersona = (val: string | null | undefined): string => {
      if (!val) return '';
      if (!UUID_RE.test(val)) return val; // legacy: already a name
      const u = userById.get(val);
      return u ? ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || val) : val;
    };

    const tasks       = tasksResult.records;
    const projectName = projectResult?.fullName || input.projectCode;
    const now         = new Date().toISOString();

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

    // Deduped columns for board schema (last one wins on duplicate names)
    const deduped = new Map<string, typeof activeCols[0]>();
    for (const col of activeCols) {
      deduped.set((col.columnName ?? col.id).toLowerCase().trim(), col);
    }

    const boardColumns: { id: string; title: string; type: string }[] = [
      { id: 'name', title: 'Name', type: 'name' },
      ...Array.from(deduped.values()).map(col => ({
        id: col.id,
        title: col.columnName ?? col.id,
        type: mapColType(col.columnType),
      })),
    ];

    const hasCronograma = deduped.has('cronograma') || deduped.has('cronograma general');
    if (!hasCronograma) {
      boardColumns.push({ id: 'cronograma_calc', title: 'Cronograma', type: 'timeline' });
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

    // ── Build task subitem ──────────────────────────────────────────────────
    function buildSubitem(t: typeof tasks[0]) {
      const startCell      = resolveCell(t.id, 'Inicio');
      const endCell        = resolveCell(t.id, 'Fin');
      const statusCell     = resolveCell(t.id, 'Estado');
      const responsableCell = resolveCell(t.id, 'Responsable');
      // Resolve color: match by name "Color" OR by columnType === 'Color'
      const colorColByType = Array.from(deduped.values()).find(c => c.columnType === 'Color');
      const colorCell      = resolveCell(t.id, 'Color') ??
        (colorColByType ? cellsByTaskCol.get(t.id)?.get(colorColByType.id) : undefined);

      const startDate  = startCell?.dateValue?.split('T')[0]  || t.startDate?.split('T')[0]  || '';
      const endDate    = endCell?.dateValue?.split('T')[0]    || t.endDate?.split('T')[0]    || '';
      const status     = statusCell?.textValue  || t.status     || '';
      const assignedTo = resolvePersona(responsableCell?.textValue || t.assignedTo || '');
      const color      = colorCell?.textValue   || null;

      const cronText  = startDate && endDate ? `${startDate} - ${endDate}` : (startDate || endDate || '');
      const cronValue = startDate || endDate
        ? JSON.stringify({ to: endDate || startDate, from: startDate || endDate, changed_at: now })
        : null;

      const column_values = Array.from(deduped.values()).map(col => {
        const colType     = mapColType(col.columnType);
        const cell        = cellsByTaskCol.get(t.id)?.get(col.id);
        const colNameLower = (col.columnName ?? '').toLowerCase().trim();

        if (colNameLower === 'inicio') {
          return { id: col.id, text: startDate, value: startDate ? JSON.stringify({ date: startDate, changed_at: now }) : null, type: colType };
        }
        if (colNameLower === 'fin') {
          return { id: col.id, text: endDate, value: endDate ? JSON.stringify({ date: endDate, changed_at: now }) : null, type: colType };
        }
        if (colNameLower === 'estado') {
          return { id: col.id, text: status, value: status ? JSON.stringify({ index: 0, post_id: null, changed_at: now }) : null, type: colType };
        }
        if (colNameLower === 'responsable' || colType === 'people') {
          return { id: col.id, text: assignedTo, value: assignedTo ? JSON.stringify({ changed_at: now, personsAndTeams: [{ id: assignedTo, kind: 'person' }] }) : null, type: colType };
        }
        if (colNameLower === 'color' || colType === 'color_picker') {
          return { id: col.id, text: color, value: color ? JSON.stringify({ color, changed_at: now }) : null, type: colType };
        }
        const text = cell?.textValue || cell?.dateValue?.split('T')[0] || '';
        return { id: col.id, text, value: text || null, type: colType };
      });

      if (!hasCronograma) {
        column_values.push({ id: 'cronograma_calc', text: cronText, value: cronValue, type: 'timeline' });
      }

      return { id: t.id, name: t.taskName ?? '', column_values };
    }

    // ── Bucket tasks into groups ────────────────────────────────────────────
    const topLevelTasks = tasks.filter(t => !t.parentTaskId);

    // One bucket per group (in order), plus a catch-all for ungrouped
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

    // ── Build items array ───────────────────────────────────────────────────
    // Ungrouped tasks go FIRST (chronological), then named groups (each chronological)
    const boardDef = { id: boardId, columns: boardColumns };

    const items: object[] = [];

    // 1. Ungrouped tasks at the top (with empty header)
    if (ungrouped.length > 0 || activeGroupCols.length === 0) {
      items.push({
        id: 'ungrouped',
        name: ' ',
        color: null,
        color_hex: '#6B7280',
        board: boardDef,
        column_values: [],
        subitems: sortByStartDate(ungrouped).map(buildSubitem),
      });
    }

    // 2. Named groups, each with tasks sorted by start date
    for (const g of activeGroupCols) {
      const bucket   = groupBuckets.get(g.id) ?? [];
      const colorId  = g.columnType ?? null;
      items.push({
        id: g.id,
        name: g.columnName ?? 'Sin nombre',
        color: colorId,
        color_hex: colorIdToHex(colorId),
        board: boardDef,
        column_values: [],
        subitems: sortByStartDate(bucket).map(buildSubitem),
      });
    }

    const payload = {
      project: projectName,
      title: titleStr,
      version: versionStr,
      logo_url: 'https://i.postimg.cc/hjCKc6D1/logo-sapience-transparente.png',
      items,
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Webhook responded with ${res.status}`);

      let body: Record<string, any> = {};
      try { body = await res.json(); } catch { /* not JSON */ }

      // Resolve file URL from any common field name n8n might return
      const resolvedFileUrl: string | undefined =
        body.fileUrl ?? body.file_url ?? body.url ??
        body.webUrl  ?? body.pdfUrl   ?? undefined;

      const updatedAt = new Date().toISOString();

      if (body.status === 'success' && resolvedFileUrl) {
        if (projectResult?.id) {
          try {
            await Projects.update({ id: projectResult.id, record: { timelineStatus: 'Listo', timelineUrl: resolvedFileUrl, timelineUpdatedAt: updatedAt } });
          } catch { /* best-effort */ }
        }
        // Save document record
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
        // Persist version counter in Board record
        if (boardRecord?.id) {
          try { await Boards.update({ id: boardRecord.id, record: { timelineVersion: autoVersion } as any }); } catch { /* best-effort */ }
        }
        return { success: true, taskCount: tasks.length, timelineStatus: 'Listo', fileUrl: resolvedFileUrl, version: versionStr };
      } else {
        if (projectResult?.id) {
          await Projects.update({ id: projectResult.id, record: { timelineStatus: 'Error', timelineUpdatedAt: updatedAt } });
        }
        // Still persist version counter even on n8n error
        if (boardRecord?.id) {
          try { await Boards.update({ id: boardRecord.id, record: { timelineVersion: autoVersion } as any }); } catch { /* best-effort */ }
        }
        return { success: true, taskCount: tasks.length, timelineStatus: 'Error', version: versionStr };
      }
    } catch (err) {
      if (projectResult?.id) {
        try { await Projects.update({ id: projectResult.id, record: { timelineStatus: 'Error', timelineUpdatedAt: new Date().toISOString() } }); } catch { /* best-effort */ }
      }
      throw err;
    }
  },
});
