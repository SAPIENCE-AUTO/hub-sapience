import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Boards, BoardColumns, CellValues, Projects } from 'zite-integrations-backend-sdk';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

const GROUP_COLOR_IDS = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'primary', 'destructive', 'muted'];

const colMappingSchema = z.object({
  excelIndex:        z.number(),
  target:            z.enum(['participantName', 'email', 'phone', 'idNumber', 'status', 'skip', 'dynamic']),
  dynamicColumnName: z.string().optional(),
  included:          z.boolean(),
});

const duplicateSchema = z.object({
  rowIndex:       z.number(),
  name:           z.string(),
  email:          z.string(),
  phone:          z.string(),
  level:          z.enum(['same_client', 'already_participated', 'external_duplicate', 'same_project', 'same_board']),
  matchedProject: z.string(),
  matchedBoard:   z.string(),
  matchedStatus:  z.string(),
  matchedBy:      z.enum(['email', 'name', 'phone']),
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const LEVEL_RANK: Record<string, number> = {
  same_client:          5,
  already_participated: 4,
  external_duplicate:   3,
  same_project:         2,
  same_board:           1,
};

export default createEndpoint({
  description: 'Import parsed Excel/CSV rows into a recruitment board, with full 4-level duplicate detection.',
  authenticated: true,
  inputSchema: z.object({
    boardId:         z.string(),
    boardName:       z.string(),
    projectCode:     z.string(),
    currentClient:   z.string().optional(), // for same-client detection
    createNewBoard:  z.boolean().optional(),
    newBoardName:    z.string().optional(),
    columnMapping:   z.array(colMappingSchema),
    groups:          z.array(z.object({ name: z.string(), rowIndices: z.array(z.number()) })),
    groupDecisions:  z.array(z.object({ name: z.string(), action: z.enum(['create', 'skip']) })).optional(),
    rows:            z.array(z.array(z.string())),
    dryRun:          z.boolean().optional(),
    skipDuplicates:  z.boolean().optional(),
  }),
  outputSchema: z.object({
    imported:        z.number(),
    groupsCreated:   z.number(),
    columnsCreated:  z.number(),
    newBoardName:    z.string().optional(),
    duplicates:      z.array(duplicateSchema),
    newCount:        z.number(),
    duplicateCount:  z.number(),
  }),
  execute: async ({ input }) => {
    const effectiveCreateNewBoard = (input.createNewBoard ?? false) || !input.boardId;
    const targetBoardName = effectiveCreateNewBoard && input.newBoardName?.trim()
      ? input.newBoardName.trim()
      : input.boardName;
    const targetBoardId = input.boardId;

    // ── Helper: get mapped value from row ─────────────────────────────────
    const includedMappings = input.columnMapping.filter(m => m.included);
    const getVal = (row: string[], target: string) => {
      let val = '';
      for (const m of includedMappings) {
        if (m.target === target) {
          const v = (row[m.excelIndex] ?? '').trim();
          if (v) val = v;
        }
      }
      return val;
    };

    // ── Duplicate detection (mirrors recalculateDuplicateNotes logic) ─────
    const duplicates: z.infer<typeof duplicateSchema>[] = [];
    const duplicateRowIndices = new Set<number>();

    // Always run duplicate detection unless creating a brand-new board
    if (!effectiveCreateNewBoard) {
      // 1. Fetch ALL active rows across ALL projects
      type AnyRow = { id: string; participantName?: string; email?: string; phone?: string; projectCode?: string; boardName?: string; status?: string; group?: string; deletedAt?: string };
      const allRows: AnyRow[] = [];
      let offset = 0;
      while (true) {
        const { records, hasMore } = await RecruitmentRows.findAll({
          limit: 2000, offset,
          fields: ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'deletedAt'],
        });
        allRows.push(...records.filter(r => !r.deletedAt));
        if (!hasMore) break;
        offset += records.length;
      }

      // 2. Fetch project dates
      const { records: allProjects } = await Projects.findAll({
        limit: 500,
        fields: ['projectCode', 'startDate', 'endDate', 'client'],
      });
      const projectDatesMap = new Map<string, { startDate?: string; endDate?: string; client?: string }>();
      for (const p of allProjects) {
        if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate ?? undefined, endDate: p.endDate ?? undefined, client: p.client ?? undefined });
      }

      // 3. Build lookup maps
      const emailMap = new Map<string, AnyRow[]>();
      const nameMap  = new Map<string, AnyRow[]>();
      const phoneMap = new Map<string, AnyRow[]>();

      for (const r of allRows) {
        if (r.email) {
          const k = r.email.toLowerCase().trim();
          if (!emailMap.has(k)) emailMap.set(k, []);
          emailMap.get(k)!.push(r);
        }
        if (r.participantName) {
          const k = normalize(r.participantName);
          if (k.length > 2) {
            if (!nameMap.has(k)) nameMap.set(k, []);
            nameMap.get(k)!.push(r);
          }
        }
        if (r.phone) {
          const k = r.phone.replace(/[\s\-().+]/g, '');
          if (k.length >= 7) {
            if (!phoneMap.has(k)) phoneMap.set(k, []);
            phoneMap.get(k)!.push(r);
          }
        }
      }

      const currentDates = projectDatesMap.get(input.projectCode);
      const currentStart = currentDates?.startDate ? new Date(currentDates.startDate) : null;
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // 4. For each Excel row, find matches and classify
      for (let idx = 0; idx < input.rows.length; idx++) {
        const row   = input.rows[idx];
        const email = getVal(row, 'email').toLowerCase().trim();
        const name  = normalize(getVal(row, 'participantName'));
        const phone = getVal(row, 'phone').replace(/[\s\-().+]/g, '');

        // Gather all matching existing rows with the field that matched
        const candidates: { row: AnyRow; matchedBy: 'email' | 'name' | 'phone' }[] = [];
        const seen = new Set<string>();

        const addCandidates = (rows: AnyRow[], by: 'email' | 'name' | 'phone') => {
          for (const r of rows) {
            if (!seen.has(r.id)) { seen.add(r.id); candidates.push({ row: r, matchedBy: by }); }
          }
        };

        if (email) addCandidates(emailMap.get(email) ?? [], 'email');
        if (name.length > 2) addCandidates(nameMap.get(name) ?? [], 'name');
        if (phone.length >= 7) addCandidates(phoneMap.get(phone) ?? [], 'phone');

        if (candidates.length === 0) continue;

        // 5. Classify each candidate — keep worst level
        let worstLevel: z.infer<typeof duplicateSchema>['level'] | null = null;
        let worstCandidate: { row: AnyRow; matchedBy: 'email' | 'name' | 'phone' } | null = null;

        for (const c of candidates) {
          const r = c.row;
          if (!r.projectCode) continue;

          let level: z.infer<typeof duplicateSchema>['level'];

          const sameProject = r.projectCode === input.projectCode;
          const sameBoard   = sameProject && r.boardName === targetBoardName;

          const normalizeStr = (s?: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          const otherClient = projectDatesMap.get(r.projectCode)?.client;
          const sameClient  = !sameProject && !!input.currentClient && !!otherClient &&
            normalizeStr(otherClient) === normalizeStr(input.currentClient);

          if (sameBoard) {
            level = 'same_board';
          } else if (sameProject) {
            level = 'same_project';
          } else {
            // Cross-project: classify as red (same_client / already_participated) or blue (external_duplicate)
            const participated = r.status === 'Asistió' || (!!r.group && r.group.trim() !== '');
            const otherDates   = projectDatesMap.get(r.projectCode);
            const otherEnd     = otherDates?.endDate ? new Date(otherDates.endDate) : null;
            // Active or recently ended (< 6 months)
            const isRecentOrActive = !otherEnd || otherEnd > sixMonthsAgo;
            if (sameClient && participated) {
              // Same client AND participated → red warning
              level = 'same_client';
            } else if (participated && isRecentOrActive) {
              // Participated recently or still active in another project → red
              level = 'already_participated';
            } else {
              // Old participation (> 6mo) or no participation → blue
              level = 'external_duplicate';
            }
          }

          if (!worstLevel || LEVEL_RANK[level] > LEVEL_RANK[worstLevel]) {
            worstLevel = level;
            worstCandidate = c;
          }
        }

        if (worstLevel && worstCandidate) {
          duplicates.push({
            rowIndex:       idx,
            name:           getVal(row, 'participantName') || `Fila ${idx + 1}`,
            email:          getVal(row, 'email'),
            phone:          getVal(row, 'phone'),
            level:          worstLevel,
            matchedProject: worstCandidate.row.projectCode ?? '',
            matchedBoard:   worstCandidate.row.boardName   ?? '',
            matchedStatus:  worstCandidate.row.status      ?? '',
            matchedBy:      worstCandidate.matchedBy,
          });
          duplicateRowIndices.add(idx);
        }
      }
    }

    const newCount       = input.rows.length - duplicateRowIndices.size;
    const duplicateCount = duplicates.length;

    // ── Dry run — just return analysis ────────────────────────────────────
    if (input.dryRun) {
      return { imported: 0, groupsCreated: 0, columnsCreated: 0, duplicates, newCount, duplicateCount };
    }

    // ── Resolve / create target board ─────────────────────────────────────
    let resolvedBoardId = targetBoardId;
    let legacyBoardId: string | undefined = targetBoardId;

    if (effectiveCreateNewBoard && input.newBoardName?.trim()) {
      const { records: existing } = await Boards.findAll({ filters: { projectCode: input.projectCode }, limit: 200 });
      const created = await Boards.create({ record: { boardName: input.newBoardName.trim(), projectCode: input.projectCode, boardOrder: existing.length } });
      resolvedBoardId = created.id;
      legacyBoardId = targetBoardId;
      console.log('[importExcelData] New board created with UUID', { resolvedBoardId, legacyBoardId });
    } else {
      // Existing board — resolve to UUID
      try {
        const res = await resolveWriteBoardId(targetBoardId);
        resolvedBoardId = res.writeBoardId;
        legacyBoardId = res.legacyBoardId ?? targetBoardId;
        if (res.reason === 'legacy-fallback' || res.reason === 'input-passthrough') {
          console.warn('[importExcelData] Board UUID not found, using legacy', { targetBoardId, reason: res.reason });
        }
      } catch (err) {
        console.warn('[importExcelData] resolveWriteBoardId failed', { targetBoardId, error: String(err) });
      }
    }

    // ── Resolve UUID for groups board ID ────────────────────────────────
    const groupsBoardId = `${resolvedBoardId}::groups`;

    // ── Build group decision lookup ───────────────────────────────────────
    const groupDecisionMap = new Map<string, 'create' | 'skip'>();
    if (input.groupDecisions) {
      for (const gd of input.groupDecisions) groupDecisionMap.set(gd.name, gd.action);
    }

    // ── Create group columns (only for groups with action 'create') ──────
    const groupColMap = new Map<string, string>();
    let groupsCreated = 0;
    for (let i = 0; i < input.groups.length; i++) {
      const g = input.groups[i];
      const action = groupDecisionMap.get(g.name) ?? 'create';
      if (action === 'skip') continue;
      const rec = await BoardColumns.create({
        record: { columnName: g.name, boardId: groupsBoardId, columnType: GROUP_COLOR_IDS[i % GROUP_COLOR_IDS.length], columnOrder: i },
      });
      groupColMap.set(g.name, rec.id);
      groupsCreated++;
    }

    // ── Create dynamic columns ─────────────────────────────────────────────
    const dynColMap    = new Map<string, string>();
    let columnsCreated = 0;
    const dynamicMappings = input.columnMapping.filter(m => m.included && m.target === 'dynamic' && m.dynamicColumnName);

    // Dual-read: UUID first, then legacy fallback
    const { records: existingColsUuid } = await BoardColumns.findAll({ filters: { boardId: resolvedBoardId }, limit: 200 });
    let existingCols = [...existingColsUuid];

    if (legacyBoardId && legacyBoardId !== resolvedBoardId) {
      const { records: existingColsLegacy } = await BoardColumns.findAll({ filters: { boardId: legacyBoardId }, limit: 200 });
      // Deduplicate by columnName — prefer UUID version
      const seenNames = new Set(existingCols.map(c => c.columnName?.toLowerCase() ?? ''));
      for (const lc of existingColsLegacy) {
        if (!seenNames.has(lc.columnName?.toLowerCase() ?? '')) {
          existingCols.push(lc);
          seenNames.add(lc.columnName?.toLowerCase() ?? '');
        }
      }
    }
    const existingByName = new Map(existingCols.map(c => [c.columnName?.toLowerCase() ?? '', c.id]));

    for (let i = 0; i < dynamicMappings.length; i++) {
      const name = dynamicMappings[i].dynamicColumnName!;
      const key  = name.toLowerCase();
      if (existingByName.has(key)) {
        dynColMap.set(name, existingByName.get(key)!);
      } else {
        const rec = await BoardColumns.create({
          record: { columnName: name, boardId: resolvedBoardId, columnType: 'Texto', columnOrder: existingCols.length + i },
        });
        dynColMap.set(name, rec.id);
        columnsCreated++;
      }
    }

    // ── Build row → group lookup ───────────────────────────────────────────
    const rowToGroup = new Map<number, string>();
    for (const g of input.groups) {
      for (const idx of g.rowIndices) rowToGroup.set(idx, g.name);
    }

    // ── Filter rows if skipDuplicates ──────────────────────────────────────
    const rowsToImport = input.skipDuplicates
      ? input.rows.map((r, i) => ({ row: r, excelIdx: i })).filter(({ excelIdx }) => !duplicateRowIndices.has(excelIdx))
      : input.rows.map((r, i) => ({ row: r, excelIdx: i }));

    // ── BulkCreate recruitment rows ────────────────────────────────────────
    const rowPayloads = rowsToImport.map(({ row, excelIdx }) => {
      const name = getVal(row, 'participantName') || `Participante ${excelIdx + 1}`;
      const explicitStatus = getVal(row, 'status');
      // Determine default status: if participant belongs to a group marked 'create', default to 'Asistió'
      let defaultStatus = 'Pendiente';
      const groupName = rowToGroup.get(excelIdx);
      if (groupName) {
        const action = groupDecisionMap.get(groupName) ?? 'create';
        if (action === 'create') defaultStatus = 'Asistió';
      }
      return {
        excelIdx,
        record: {
          rowName:         name,
          participantName: name,
          email:           getVal(row, 'email')    || undefined,
          phone:           getVal(row, 'phone')    || undefined,
          idNumber:        getVal(row, 'idNumber') || undefined,
          status:          explicitStatus || defaultStatus,
          projectCode:     input.projectCode,
          boardName:       targetBoardName,
          boardId:         resolvedBoardId,
          level:           0,
        },
      };
    });

    const createdIds: Array<{ id: string; excelIdx: number }> = [];
    for (let i = 0; i < rowPayloads.length; i += 100) {
      const batch = rowPayloads.slice(i, i + 100);
      const res   = await RecruitmentRows.bulkCreate({ records: batch.map(b => b.record) });
      res.records.forEach((r, j) => createdIds.push({ id: r.id, excelIdx: batch[j].excelIdx }));
    }

    // ── BulkCreate cell values ─────────────────────────────────────────────
    const cellsToCreate: Array<{ boardId: string; rowId: string; columnId: string; textValue: string }> = [];
    for (const { id, excelIdx } of createdIds) {
      const row = input.rows[excelIdx];
      const cellGroupName = rowToGroup.get(excelIdx);
      if (cellGroupName && groupColMap.has(cellGroupName)) {
        cellsToCreate.push({ boardId: groupsBoardId, rowId: id, columnId: groupColMap.get(cellGroupName)!, textValue: '1' });
      }
      for (const m of dynamicMappings) {
        const val = (row[m.excelIndex] ?? '').trim();
        if (val && m.dynamicColumnName && dynColMap.has(m.dynamicColumnName)) {
          cellsToCreate.push({ boardId: resolvedBoardId, rowId: id, columnId: dynColMap.get(m.dynamicColumnName)!, textValue: val });
        }
      }
    }
    for (let i = 0; i < cellsToCreate.length; i += 100) {
      await CellValues.bulkCreate({ records: cellsToCreate.slice(i, i + 100) });
    }

    return {
      imported:      createdIds.length,
      groupsCreated,
      columnsCreated,
      newBoardName:  effectiveCreateNewBoard ? targetBoardName : undefined,
      duplicates,
      newCount:      createdIds.length,
      duplicateCount,
    };
  },
});
