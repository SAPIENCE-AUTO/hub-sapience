import { z } from 'zod';
import { createEndpoint, SharedViews, RecruitmentRows, BoardColumns, CellValues, CalendarEvents, Boards } from '../../server/compat';

type FilterRule = {
  id: string;
  column: string;
  operator: string;
  value: string;
  value2?: string;
  selectedValues?: string[];
};

const FIXED_KEYS = new Set(['participantName', 'email', 'phone', 'idNumber', 'status']);

function matchRule(rowValues: Record<string, string>, rule: FilterRule): boolean {
  const rawVal = rowValues[rule.column] ?? '';

  if (rule.operator === 'vacio')    return !rawVal.trim();
  if (rule.operator === 'no_vacio') return !!rawVal.trim();

  const selVals = rule.selectedValues?.length ? rule.selectedValues : [rule.value];
  if (rule.operator === 'es')            return rawVal === rule.value;
  if (rule.operator === 'no_es')         return rawVal !== rule.value;
  if (rule.operator === 'es_alguno')     return selVals.includes(rawVal);
  if (rule.operator === 'no_es_ninguno') return !selVals.includes(rawVal);

  const numVal = parseFloat(rawVal);
  if (rule.operator === 'mayor_que')   return !isNaN(numVal) && numVal > parseFloat(rule.value);
  if (rule.operator === 'menor_que')   return !isNaN(numVal) && numVal < parseFloat(rule.value);
  if (rule.operator === 'mayor_igual') return !isNaN(numVal) && numVal >= parseFloat(rule.value);
  if (rule.operator === 'menor_igual') return !isNaN(numVal) && numVal <= parseFloat(rule.value);
  if (rule.operator === 'entre') {
    return !isNaN(numVal) && numVal >= parseFloat(rule.value) && numVal <= parseFloat(rule.value2 ?? '');
  }

  const val = rawVal.toLowerCase();
  const textVals = (rule.selectedValues?.length ? rule.selectedValues : rule.value ? [rule.value] : [])
    .map(v => v.toLowerCase());
  if (textVals.length === 0) return true;
  if (rule.operator === 'contiene')    return textVals.some(rv => val.includes(rv));
  if (rule.operator === 'no_contiene') return textVals.every(rv => !val.includes(rv));
  if (rule.operator === 'igual_a')     return textVals.some(rv => val === rv);
  if (rule.operator === 'no_igual_a')  return textVals.every(rv => val !== rv);
  if (rule.operator === 'empieza_con') return textVals.some(rv => val.startsWith(rv));
  if (rule.operator === 'termina_con') return textVals.some(rv => val.endsWith(rv));

  return true;
}

const rowSchema = z.object({
  id: z.string(),
  participantName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  idNumber: z.string().optional(),
  status: z.string().optional(),
  dynamicValues: z.record(z.string()).optional(),
  groupId: z.string().optional(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Public endpoint — returns data for a shared view by token (no auth required)',
  inputSchema: z.object({ token: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    viewName: z.string().optional(),
    boardName: z.string().optional(),
    projectCode: z.string().optional(),
    visibleColumns: z.array(z.string()).optional(),
    dynamicColumns: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
    groups: z.array(z.object({
      id: z.string(),
      name: z.string(),
      colorId: z.string().optional(),
      eventDate: z.string().optional(),
      durationHours: z.number().optional(),
    })).optional(),
    filters: z.object({
      filterRules: z.array(z.any()).optional(),
      filterMode: z.string().optional(),
      statuses: z.array(z.string()).optional(),
    }).optional(),
    rows: z.array(rowSchema).optional(),
  }),
  execute: async ({ input }) => {
    // ── 1. Load external view (metadata + active check) ──────────────────
    const externalView = await SharedViews.findOne({ filters: { token: input.token } });
    if (!externalView || !externalView.active) return { found: false };

    // ── 2. Try to load the linked internal view for live filters ──────────
    // The internal view has sharedToken = this external view's token
    let filtersData: {
      filterRules?: FilterRule[];
      filterMode?: 'and' | 'or';
      columnFilters?: Record<string, string[]>;
      hiddenColumns?: string[];
      sortColumn?: string | null;
      sortDirection?: 'asc' | 'desc';
      // legacy external format fields
      statuses?: string[];
      selectedGroups?: string[];
      showNoGroup?: boolean;
    } = {};

    let usingInternalView = false;

    const internalView = await SharedViews.findOne({ filters: { sharedToken: input.token } });
    if (internalView?.filtersJson) {
      try {
        filtersData = JSON.parse(internalView.filtersJson);
        usingInternalView = true;
      } catch { /* fall through to external */ }
    }

    // Fallback: use external view's own filtersJson (backward compat for old views / deleted internals)
    if (!usingInternalView && externalView.filtersJson) {
      try {
        filtersData = JSON.parse(externalView.filtersJson);
      } catch { /* keep empty */ }
    }

    // ── 3. Extract filter config ──────────────────────────────────────────
    const filterRules: FilterRule[] = filtersData.filterRules ?? [];
    const filterMode: 'and' | 'or' = filtersData.filterMode ?? 'and';
    const legacyStatuses: string[] = filtersData.statuses ?? [];

    // Internal format: columnFilters is Record<string, string[]>
    const columnFilters: Record<string, string[]> = filtersData.columnFilters ?? {};
    const hiddenColumns = new Set<string>(filtersData.hiddenColumns ?? []);

    // Legacy external format group config (fallback path)
    const legacySelectedGroupIds: string[] = filtersData.selectedGroups ?? [];
    const legacyShowNoGroup: boolean = filtersData.showNoGroup ?? true;

    // ── 3b. Resolve board UUID for legacy boardIds ──────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let resolvedBoardUuid: string | null = null;
    if (externalView.boardId && !UUID_RE.test(externalView.boardId)) {
      // Legacy composite boardId — resolve to UUID via Boards table
      // Use findAll instead of findOne to handle duplicate deleted boards with the same name
      if (externalView.projectCode && externalView.boardName) {
        const { records: boardCandidates } = await Boards.findAll({
          filters: { projectCode: externalView.projectCode, boardName: externalView.boardName },
          limit: 10,
        });
        const activeBoard = boardCandidates.find(b => !b.deletedAt);
        if (activeBoard) {
          resolvedBoardUuid = activeBoard.id;
        }
      }
    }

    // ── 4. Load board columns ─────────────────────────────────────────────
    let boardColMap: Record<string, string> = {};
    let allDynColIds: string[] = [];
    if (externalView.boardId) {
      const { records: boardCols } = await BoardColumns.findAll({
        filters: { boardId: externalView.boardId },
        limit: 500,
      });

      // Also fetch from UUID boardId if it differs (legacy external views store
      // the composite boardId but columns may only exist under the UUID after migration)
      let mergedBoardCols = [...boardCols];
      if (resolvedBoardUuid && resolvedBoardUuid !== externalView.boardId) {
        const { records: uuidBoardCols } = await BoardColumns.findAll({
          filters: { boardId: resolvedBoardUuid },
          limit: 500,
        });
        const seenIds = new Set(mergedBoardCols.map(c => c.id));
        for (const c of uuidBoardCols) {
          if (!seenIds.has(c.id)) {
            mergedBoardCols.push(c);
            seenIds.add(c.id);
          }
        }
      }

      const activeCols = mergedBoardCols.filter(c => !c.deletedAt && c.columnType !== '__fillout_link__');
      boardColMap = Object.fromEntries(activeCols.map(c => [c.id, c.columnName ?? c.id]));
      allDynColIds = activeCols.map(c => c.id);
    }

    // ── 5. Compute visible columns ────────────────────────────────────────
    // Internal view: derive visibleColumns from allDynColIds minus hiddenColumns
    // External view fallback: use stored visibleColumnsJson
    let visibleColumns: string[];
    if (usingInternalView) {
      const fixedCols = ['participantName', 'email', 'phone', 'idNumber', 'status'];
      const allCols = [...fixedCols, ...allDynColIds];
      visibleColumns = hiddenColumns.size > 0
        ? allCols.filter(id => !hiddenColumns.has(id))
        : allCols;
    } else {
      visibleColumns = externalView.visibleColumnsJson
        ? JSON.parse(externalView.visibleColumnsJson)
        : ['participantName', 'email', 'phone', 'status'];
    }

    const visibleDynIds = visibleColumns.filter(id => !FIXED_KEYS.has(id));

    // ── 6. Load group columns ─────────────────────────────────────────────
    type GroupCol = { id: string; name: string; colorId?: string };
    let activeGroupCols: GroupCol[] = [];
    if (externalView.boardId) {
      const { records: groupCols } = await BoardColumns.findAll({
        filters: { boardId: `${externalView.boardId}::groups` },
        limit: 500,
      });

      // Also fetch from UUID boardId if it differs (legacy external views store the composite boardId
      // but group columns may only exist under the UUID boardId after migration)
      let mergedGroupCols = [...groupCols];
      if (resolvedBoardUuid && resolvedBoardUuid !== externalView.boardId) {
        const { records: uuidGroupCols } = await BoardColumns.findAll({
          filters: { boardId: `${resolvedBoardUuid}::groups` },
          limit: 500,
        });
        // Merge, deduplicating by id (UUID results fill gaps)
        const seenIds = new Set(mergedGroupCols.map(c => c.id));
        for (const c of uuidGroupCols) {
          if (!seenIds.has(c.id)) {
            mergedGroupCols.push(c);
            seenIds.add(c.id);
          }
        }
      }

      // Fallback: SIEMPRE intentar también el boardId legacy compuesto, no
      // solo cuando el UUID no trajo nada. Casos reales como NARANJA tienen
      // grupos repartidos entre los dos: algunos ya migrados a UUID (G3, G4),
      // otros todavía solo bajo el string legacy (G1, G2, G5, G6) — con el
      // guard "=== 0" de antes, en cuanto el UUID encontraba AUNQUE FUERA UNO,
      // el resto de los grupos legacy se perdían en silencio (se colapsaban
      // a "Sin grupo" más abajo). Mismo patrón sin guard que ya usa el merge
      // de arriba (UUID vs boardId de la vista externa).
      if (externalView.projectCode && externalView.boardName) {
        const legacyGroupBoardId = `recruitment-${externalView.projectCode}-${externalView.boardName}::groups`;
        if (legacyGroupBoardId !== `${externalView.boardId}::groups`) {
          const { records: legacyGroupCols } = await BoardColumns.findAll({
            filters: { boardId: legacyGroupBoardId },
            limit: 500,
          });
          const seenIds = new Set(mergedGroupCols.map(c => c.id));
          for (const c of legacyGroupCols) {
            if (!seenIds.has(c.id)) {
              mergedGroupCols.push(c);
              seenIds.add(c.id);
            }
          }
        }
      }

      const rawGroupCols = mergedGroupCols
        .filter(c => !c.deletedAt)
        .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

      // Collect linked event IDs per group
      const groupEventIdMap = new Map<string, string>(); // groupColId → eventId
      for (const c of rawGroupCols) {
        if (c.optionsJson) {
          try {
            const opts = JSON.parse(c.optionsJson) as Record<string, unknown>;
            const evId = (opts.linkedCalEvent as Record<string, string> | undefined)?.eventId;
            if (evId) groupEventIdMap.set(c.id, evId);
          } catch {}
        }
      }

      // Batch-fetch linked event native fields
      const eventIds = [...new Set(groupEventIdMap.values())];
      const eventInfoMap = new Map<string, { eventDate?: string; durationHours?: number; location?: string }>();

      if (eventIds.length > 0) {
        const { records: evRecords } = await CalendarEvents.findAll({
          filters: { id: { in: eventIds } },
          limit: 500,
        });

        const needsFallback: string[] = [];
        for (const ev of evRecords) {
          eventInfoMap.set(ev.id, {
            eventDate: ev.eventDate ?? undefined,
            durationHours: ev.durationHours ?? undefined,
          });
          if (!ev.eventDate) needsFallback.push(ev.id);
        }

        // Fallback: read dynamic CellValues for events missing native eventDate
        if (needsFallback.length > 0) {
          const { records: fallbackCells } = await CellValues.findAll({
            filters: { rowId: { in: needsFallback } },
            limit: 1000,
          });
          if (fallbackCells.length > 0) {
            const fallbackColIds = [...new Set(fallbackCells.map(c => c.columnId).filter((id): id is string => !!id))];
            const { records: fallbackCols } = await BoardColumns.findAll({
              filters: { id: { in: fallbackColIds } },
              limit: 200,
            });
            const colById = new Map(fallbackCols.map(c => [c.id, c]));
            for (const cell of fallbackCells) {
              const evId = cell.rowId;
              if (!evId || !eventInfoMap.has(evId)) continue;
              const col = colById.get(cell.columnId ?? '');
              if (!col?.columnName) continue;
              const info = eventInfoMap.get(evId)!;
              if (col.columnName === 'Fecha y hora' && cell.dateValue && !info.eventDate) {
                info.eventDate = cell.dateValue;
              } else if (col.columnName === 'Duración (hrs)' && cell.numberValue != null && info.durationHours == null) {
                info.durationHours = cell.numberValue;
              } else if (col.columnName === 'Dirección' && cell.textValue && !info.location) {
                info.location = cell.textValue;
              }
            }
          }
        }
      }

      activeGroupCols = rawGroupCols.map(c => {
          let publicName: string | undefined;
          if (c.optionsJson) {
            try { publicName = (JSON.parse(c.optionsJson) as Record<string, unknown>).publicName as string | undefined || undefined; } catch {}
          }
          const evId = groupEventIdMap.get(c.id);
          const evInfo = evId ? eventInfoMap.get(evId) : undefined;
          return {
            id: c.id,
            name: publicName ?? c.columnName ?? 'Grupo',
            colorId: c.columnType ?? undefined,
            eventDate: evInfo?.eventDate,
            durationHours: evInfo?.durationHours,
          };
        });
    }

    // ── 7. Load rows with pagination (dual-read: boardId UUID + boardName fallback) ──
    const allRecords: Awaited<ReturnType<typeof RecruitmentRows.findAll>>['records'] = [];
    const seenRowIds = new Set<string>();

    const pushUnique = (records: typeof allRecords) => {
      for (const r of records) {
        if (!seenRowIds.has(r.id)) {
          seenRowIds.add(r.id);
          allRecords.push(r);
        }
      }
    };

    // Primary path: query by boardId UUID (matches how internal views work)
    const effectiveBoardUuid = resolvedBoardUuid ?? (externalView.boardId && UUID_RE.test(externalView.boardId) ? externalView.boardId : null);
    if (effectiveBoardUuid) {
      let recOffset = 0;
      let recHasMore = true;
      while (recHasMore) {
        const batch = await RecruitmentRows.findAll({
          filters: { boardId: effectiveBoardUuid, ...(externalView.projectCode ? { projectCode: externalView.projectCode } : {}) },
          limit: 2000,
          offset: recOffset,
        });
        pushUnique(batch.records);
        recHasMore = batch.hasMore;
        recOffset += batch.records.length;
      }
    }

    // Fallback path: query by boardName + projectCode (catches rows without boardId)
    if (externalView.boardName && externalView.projectCode) {
      let recOffset = 0;
      let recHasMore = true;
      while (recHasMore) {
        const batch = await RecruitmentRows.findAll({
          filters: { boardName: externalView.boardName, projectCode: externalView.projectCode },
          limit: 2000,
          offset: recOffset,
        });
        pushUnique(batch.records);
        recHasMore = batch.hasMore;
        recOffset += batch.records.length;
      }
    }

    let rows = allRecords.filter(r => !r.parentRowId && !r.deletedAt);

    // Apply legacy status filter
    if (legacyStatuses.length > 0) {
      rows = rows.filter(r => legacyStatuses.includes(r.status ?? ''));
    }

    // ── 8. Build dynamic cell map from cellData on each row ───────────────
    // Reading from the denormalized cellData field (stored directly on each
    // RecruitmentRow) ensures ALL data is visible — including values written by
    // webhooks, migrations, or any path that may not have created CellValues records.
    const dynCellMap: Map<string, Record<string, string>> = new Map();

    for (const row of allRecords) {
      if (!row.cellData) continue;
      try {
        const parsed = JSON.parse(row.cellData) as Record<string, {
          textValue?: string | null;
          numberValue?: number | null;
          dateValue?: string | null;
          booleanValue?: boolean | null;
          fileUrl?: string | null;
        }>;
        const rowCells: Record<string, string> = {};
        for (const [colId, val] of Object.entries(parsed)) {
          if (!val || typeof val !== 'object') continue;
          let displayVal = '';
          if (val.textValue != null && val.textValue !== '') {
            displayVal = val.textValue;
          } else if (val.numberValue != null) {
            displayVal = String(val.numberValue);
          } else if (val.dateValue) {
            // Format in Mexico City timezone
            const d = new Date(val.dateValue);
            const cdmxDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
            const cdmxTimeParts = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Mexico_City',
              hour: '2-digit', minute: '2-digit', hour12: false,
            }).formatToParts(d);
            const hh = cdmxTimeParts.find(p => p.type === 'hour')?.value ?? '00';
            const mm = cdmxTimeParts.find(p => p.type === 'minute')?.value ?? '00';
            if (hh !== '00' || mm !== '00') {
              displayVal = `${cdmxDate} ${hh}:${mm}`;
            } else {
              displayVal = cdmxDate;
            }
          } else if (val.booleanValue != null) {
            displayVal = val.booleanValue ? 'Sí' : 'No';
          } else if (val.fileUrl) {
            displayVal = val.fileUrl;
          }
          if (displayVal !== '') rowCells[colId] = displayVal;
        }
        if (Object.keys(rowCells).length > 0) {
          dynCellMap.set(row.id, rowCells);
        }
      } catch { /* skip malformed cellData */ }
    }

    // ── 9. Load group cell values ─────────────────────────────────────────
    const rowGroupMap: Map<string, string> = new Map();
    if (externalView.boardId && activeGroupCols.length > 0) {
      const groupColIds = new Set(activeGroupCols.map(g => g.id));

      // Collect boardIds to search for group cells (legacy + UUID if resolved)
      const groupBoardIds = [`${externalView.boardId}::groups`];
      if (resolvedBoardUuid && resolvedBoardUuid !== externalView.boardId) {
        groupBoardIds.push(`${resolvedBoardUuid}::groups`);
      }
      // Also include the legacy composite boardId for group cells (covers
      // boards like NARANJA where groups weren't migrated to UUID)
      if (externalView.projectCode && externalView.boardName) {
        const legacyGroupBoardId = `recruitment-${externalView.projectCode}-${externalView.boardName}::groups`;
        if (!groupBoardIds.includes(legacyGroupBoardId)) {
          groupBoardIds.push(legacyGroupBoardId);
        }
      }

      const allGroupCells: Awaited<ReturnType<typeof CellValues.findAll>>['records'] = [];
      for (const gBoardId of groupBoardIds) {
        let gOffset = 0;
        let gHasMore = true;
        while (gHasMore) {
          const batch = await CellValues.findAll({
            filters: { boardId: gBoardId },
            limit: 2000,
            offset: gOffset,
          });
          allGroupCells.push(...batch.records);
          gHasMore = batch.hasMore;
          gOffset += batch.records.length;
        }
      }

      for (const cell of allGroupCells) {
        if (cell.rowId && cell.columnId && cell.textValue === '1' && groupColIds.has(cell.columnId)) {
          // Deduplicate: first match wins (legacy cells take precedence, UUID cells fill gaps)
          if (!rowGroupMap.has(cell.rowId)) {
            rowGroupMap.set(cell.rowId, cell.columnId);
          }
        }
      }
    }

    // ── 10. Apply group filter ────────────────────────────────────────────
    if (usingInternalView) {
      // Internal format: columnFilters['_group'] = array of group NAMES
      const groupNameFilter: string[] = columnFilters['_group'] ?? [];
      if (groupNameFilter.length > 0 && activeGroupCols.length > 0) {
        const nameToId = new Map(activeGroupCols.map(g => [g.name, g.id]));
        const allowedGroupIds = new Set(
          groupNameFilter.map(n => nameToId.get(n)).filter(Boolean) as string[]
        );
        rows = rows.filter(row => {
          const groupId = rowGroupMap.get(row.id);
          return groupId ? allowedGroupIds.has(groupId) : false;
        });
      }
    } else {
      // Legacy external format: selectedGroups = array of group IDs
      const hasGroupFilter = activeGroupCols.length > 0 && (legacySelectedGroupIds.length > 0 || !legacyShowNoGroup);
      if (hasGroupFilter) {
        rows = rows.filter(row => {
          const groupId = rowGroupMap.get(row.id);
          if (!groupId) return legacyShowNoGroup;
          return legacySelectedGroupIds.includes(groupId);
        });
      }
    }

    // ── 11. Apply columnFilters (non-group, internal format only) ─────────
    if (usingInternalView) {
      for (const [col, allowedVals] of Object.entries(columnFilters)) {
        if (col === '_group' || allowedVals.length === 0) continue;
        rows = rows.filter(row => {
          const rowVal = FIXED_KEYS.has(col)
            ? ((row as Record<string, unknown>)[col] as string | undefined) ?? ''
            : dynCellMap.get(row.id)?.[col] ?? '';
          return allowedVals.includes(rowVal);
        });
      }
    }

    // ── 12. Apply advanced filterRules ────────────────────────────────────
    if (filterRules.length > 0) {
      // '_group' is a virtual column (not in fixedVals/dynCellMap) — the
      // frontend flattens it onto each row as the group's display name
      // (RecruitmentPage.tsx's rowsWithGroup) before evaluating rules, so a
      // saved filterRule on '_group' must be resolved the same way here.
      const groupIdToName = new Map(activeGroupCols.map(g => [g.id, g.name]));
      rows = rows.filter(row => {
        const fixedVals: Record<string, string> = {
          participantName: row.participantName ?? '',
          email: row.email ?? '',
          phone: row.phone ?? '',
          idNumber: row.idNumber ?? '',
          status: row.status ?? '',
        };
        const dynVals = dynCellMap.get(row.id) ?? {};
        const groupName = groupIdToName.get(rowGroupMap.get(row.id) ?? '') ?? 'Sin grupo';
        const allVals = { ...fixedVals, ...dynVals, _group: groupName };

        const readyRules = filterRules.filter(r => {
          const noVal = ['vacio', 'no_vacio', 'esta_semana', 'este_mes'].includes(r.operator);
          if (noVal) return true;
          if (r.operator === 'entre') return !!r.value && !!r.value2;
          if (['es_alguno', 'no_es_ninguno'].includes(r.operator)) return (r.selectedValues?.length ?? 0) > 0;
          if (['contiene', 'igual_a', 'empieza_con', 'termina_con'].includes(r.operator))
            return (r.selectedValues?.length ?? 0) > 0 || !!r.value;
          return !!r.value;
        });

        if (readyRules.length === 0) return true;
        if (filterMode === 'or') return readyRules.some(rule => matchRule(allVals, rule));
        return readyRules.every(rule => matchRule(allVals, rule));
      });
    }

    // ── 12b. Apply sort order ─────────────────────────────────────────────
    const sortCol = filtersData.sortColumn ?? null;
    const sortDir = filtersData.sortDirection ?? 'asc';
    if (sortCol) {
      rows.sort((a, b) => {
        let aVal = '', bVal = '';
        if (FIXED_KEYS.has(sortCol) || sortCol === 'participantName') {
          aVal = (((a as Record<string, unknown>)[sortCol] as string) ?? '').toLowerCase();
          bVal = (((b as Record<string, unknown>)[sortCol] as string) ?? '').toLowerCase();
        } else {
          aVal = (dynCellMap.get(a.id)?.[sortCol] ?? '').toLowerCase();
          bVal = (dynCellMap.get(b.id)?.[sortCol] ?? '').toLowerCase();
        }
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    // ── 13. Build response ────────────────────────────────────────────────
    const dynamicColumns = visibleDynIds
      .filter(id => boardColMap[id])
      .map(id => ({ id, label: boardColMap[id] }));

    const rowGroupIds = new Set(rows.map(r => rowGroupMap.get(r.id)).filter(Boolean) as string[]);
    const returnedGroups = activeGroupCols.filter(g => rowGroupIds.has(g.id));

    return {
      found: true,
      viewName: externalView.viewName,
      boardName: externalView.boardName,
      projectCode: externalView.projectCode,
      visibleColumns,
      dynamicColumns,
      groups: returnedGroups,
      filters: { filterRules, filterMode, statuses: legacyStatuses },
      rows: rows.map(r => ({
        id: r.id,
        participantName: r.participantName,
        email: r.email,
        phone: r.phone,
        idNumber: r.idNumber,
        status: r.status,
        dynamicValues: dynCellMap.get(r.id) ?? {},
        groupId: rowGroupMap.get(r.id),
      })),
    };
  },
});
