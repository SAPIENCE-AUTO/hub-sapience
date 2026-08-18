import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  getBoardColumns, getCellValues, saveBoardColumn,
  deleteBoardColumn, saveCellValue,
} from 'zite-endpoints-sdk';
import type { GetBoardColumnsOutputType, GetCellValuesOutputType } from 'zite-endpoints-sdk';

export type DynColumn = GetBoardColumnsOutputType['columns'][0];
export type DynCell   = GetCellValuesOutputType['cells'][0];
export type DynCellValue = Pick<DynCell, 'textValue' | 'numberValue' | 'dateValue' | 'booleanValue' | 'fileUrl'>;

/** Minimal row shape needed to seed the cell map */
export type SeedRow = { id: string; cellData?: string | null };

const KEY = (rowId: string, colId: string) => `${rowId}::${colId}`;

/**
 * Fallback default columns for boards that have no columns yet.
 * PM timeline defaults are now created server-side via ensureTimelineDefaultColumns
 * (called by saveProject and createBoardWithTemplate), so no pm- prefix is needed here.
 */
const BOARD_DEFAULTS: { prefix: string; cols: { name: string; type: string; options?: string; order?: number }[] }[] = [
  {
    prefix: 'cal-',
    cols: [
      { name: 'Responsable',            type: 'Persona',  order: 500   },
      { name: 'Fecha y hora',           type: 'Datetime', order: 1000  },
      { name: 'Duración (hrs)',         type: 'Número',   order: 2000  },
      { name: 'Dinámica',               type: 'Texto',    order: 3000  },
      { name: 'Perfil',                 type: 'Texto',    order: 4000  },
      { name: 'Descripción',            type: 'Texto',    order: 5000  },
      { name: 'Detalles adicionales',   type: 'Texto',    order: 6000  },
      { name: 'Detalles adicionales 2', type: 'Texto',    order: 7000  },
      { name: 'Status',                 type: 'Select',   order: 8000, options: JSON.stringify(['Por realizar', 'Realizada', 'Cancelada', 'Reprogramada', 'Caída', 'Reposición']) },
      { name: 'Ubicación Interna',      type: 'Select',   order: 9000, options: JSON.stringify(['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro']) },
      { name: 'Link',                   type: 'Texto',    order: 11000 },
      { name: 'Dirección',              type: 'Texto',    order: 12000 },
    ],
  },
  {
    prefix: 'events-',
    cols: [
      { name: 'Calendario',     type: 'Texto' },
      { name: 'Fecha y hora',   type: 'Datetime' },
      { name: 'Duración (hrs)', type: 'Número' },
      { name: 'Lugar',          type: 'Texto' },
      { name: 'Asistentes',     type: 'Texto' },
      { name: 'Invite enviado', type: 'Checkbox' },
    ],
  },
];

// ── Module-level caches (survive re-renders and tab switches) ─────────────────
const colCache        = new Map<string, DynColumn[]>();
const cellMapCache    = new Map<string, Map<string, DynCell>>();
// Boards whose cache was pre-seeded (rename or duplicate) — skip fetch on next effect run
const preloadedBoards = new Set<string>();

// ── Module-level pending saves tracking ───────────────────────────────────────
let _pendingSaveCount   = 0;
let _completedSaveCount = 0;
let _failedSaveCount    = 0;
let _totalSaveCount     = 0;
const _saveListeners: Array<() => void> = [];

function _notifySaveListeners() {
  for (const cb of _saveListeners) cb();
}

export function subscribeToPendingSaves(callback: () => void): () => void {
  _saveListeners.push(callback);
  return () => {
    const idx = _saveListeners.indexOf(callback);
    if (idx !== -1) _saveListeners.splice(idx, 1);
  };
}

export function getPendingSaveState() {
  return {
    pending:   _pendingSaveCount,
    completed: _completedSaveCount,
    failed:    _failedSaveCount,
    total:     _totalSaveCount,
  };
}

async function saveWithRetry(
  boardId: string,
  op: { rowId: string; colId: string; value: DynCellValue },
  maxRetries = 2,
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await saveCellValue({ boardId, rowId: op.rowId, columnId: op.colId, ...op.value });
      return true;
    } catch {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return false;
}

/**
 * Persists a batch of cell value changes to the backend.
 * Lives at module scope so it survives component unmounts (e.g. navigating away).
 * Tracks progress and retries failed operations up to 2 times.
 */
async function persistBatchInBackground(
  boardId: string,
  ops: Array<{ rowId: string; colId: string; value: DynCellValue }>,
) {
  if (ops.length === 0) return;

  _pendingSaveCount   += ops.length;
  _totalSaveCount     += ops.length;
  _notifySaveListeners();

  // ── Group ops by rowId ────────────────────────────────────────────────────
  // saveCellValue does a read-modify-write on cellData. Running two ops for the
  // same row concurrently causes a race: both read stale cellData and the second
  // write overwrites the first. Serialising per-row eliminates this.
  const byRow = new Map<string, Array<{ rowId: string; colId: string; value: DynCellValue }>>();
  for (const op of ops) {
    if (!byRow.has(op.rowId)) byRow.set(op.rowId, []);
    byRow.get(op.rowId)!.push(op);
  }
  const rowGroups = [...byRow.values()];

  // Process up to 5 different rows concurrently, but each row's ops run sequentially
  const ROW_CONCURRENCY = 2;
  for (let i = 0; i < rowGroups.length; i += ROW_CONCURRENCY) {
    const concurrentRows = rowGroups.slice(i, i + ROW_CONCURRENCY);

    await Promise.all(concurrentRows.map(async (rowOps) => {
      for (const op of rowOps) {
        const success = await saveWithRetry(boardId, op);
        _pendingSaveCount--;
        if (success) _completedSaveCount++;
        else          _failedSaveCount++;
        _notifySaveListeners();
      }
    }));

    // Small delay between row-batches to avoid rate limits
    if (i + ROW_CONCURRENCY < rowGroups.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Reset counters once all pending saves are done
  if (_pendingSaveCount === 0) {
    setTimeout(() => {
      _completedSaveCount = 0;
      _failedSaveCount    = 0;
      _totalSaveCount     = 0;
      _notifySaveListeners();
    }, 3000); // Keep visible briefly so user sees "all done"
  }
}

/**
 * Pre-seeds the column cache for a newly duplicated board so that
 * useDynamicColumns finds data immediately without an extra fetch.
 * Call this BEFORE changing the active board.
 */
export function preSeedBoardCache(boardId: string, columns: DynColumn[], cells?: DynCell[]) {
  colCache.set(boardId, columns);
  if (cells && cells.length > 0) {
    const m = new Map<string, DynCell>();
    for (const cell of cells) {
      if (cell.rowId && cell.columnId) m.set(KEY(cell.rowId, cell.columnId), cell);
    }
    cellMapCache.set(boardId, m);
  }
  preloadedBoards.add(boardId);
}

/**
 * Migrates column and cell caches from oldBoardId to newBoardId.
 * Also handles the `::groups` variant automatically.
 * Call this BEFORE changing activeBoard so hooks find data in cache immediately.
 */
export function renameBoardCache(oldBoardId: string, newBoardId: string) {
  const suffixes = ['', '::groups'];
  for (const suffix of suffixes) {
    const oldKey = `${oldBoardId}${suffix}`;
    const newKey = `${newBoardId}${suffix}`;
    if (colCache.has(oldKey)) {
      colCache.set(newKey, colCache.get(oldKey)!);
      colCache.delete(oldKey);
    }
    if (cellMapCache.has(oldKey)) {
      cellMapCache.set(newKey, cellMapCache.get(oldKey)!);
      cellMapCache.delete(oldKey);
    }
    // Mark new key as preloaded so the hook skips the premature fetch
    preloadedBoards.add(newKey);
  }
  console.log('[useDynamicColumns] renamed cache', { oldBoardId, newBoardId });
}

// In-flight dedup for column fetches
const inFlightCols = new Map<string, Promise<{ columns: DynColumn[] }>>();

function fetchCols(boardId: string) {
  if (!inFlightCols.has(boardId)) {
    const p = getBoardColumns({ boardId }).finally(() => inFlightCols.delete(boardId));
    inFlightCols.set(boardId, p);
  }
  return inFlightCols.get(boardId)!;
}

// ── Generic concurrency limiter (max N concurrent DB fetches) ─────────────────
function makeConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length > 0) queue.shift()!();
        });
      };
      if (active < maxConcurrent) run();
      else queue.push(run);
    });
  };
}

// Serialize all cell fetches (1 at a time) to avoid rate limits
const withCellFetchLimit = makeConcurrencyLimiter(4);
// Serialize all board column saves (1 at a time) to avoid rate limits
const withColSaveLimit = makeConcurrencyLimiter(1);

/** Returns true if column data for this boardId is already in the module-level cache.
 *  Use this to decide whether staggered loading can be skipped (cache hit = no network call needed). */
export function isBoardCached(boardId: string): boolean {
  return colCache.has(boardId);
}

/** Build cell map from raw CellValues records (legacy / fallback path) */
const buildMap = (cells: DynCell[]): Map<string, DynCell> => {
  const m = new Map<string, DynCell>();
  cells.forEach(c => { if (c.rowId && c.columnId) m.set(KEY(c.rowId, c.columnId), c); });
  return m;
};

/**
 * Build cell map from rows' denormalized cellData JSON.
 * cellData format: { [columnId]: { textValue?, numberValue?, dateValue?, booleanValue?, fileUrl? } }
 * This is instant — no network call needed.
 */
const buildMapFromRows = (rows: SeedRow[]): Map<string, DynCell> => {
  const m = new Map<string, DynCell>();
  for (const row of rows) {
    if (!row.cellData) continue;
    try {
      const parsed = JSON.parse(row.cellData) as Record<string, Partial<DynCellValue>>;
      for (const [colId, val] of Object.entries(parsed)) {
        if (!val || typeof val !== 'object') continue;
        m.set(KEY(row.id, colId), {
          id: `${row.id}::${colId}`,
          rowId: row.id,
          columnId: colId,
          textValue: val.textValue,
          numberValue: val.numberValue,
          dateValue: val.dateValue,
          booleanValue: val.booleanValue,
          fileUrl: val.fileUrl,
        });
      }
    } catch { /* invalid JSON — skip */ }
  }
  return m;
};

/**
 * Hook for managing dynamic board columns and cell values.
 *
 * @param boardId  - Unique board identifier
 * @param seedRows - Optional rows with denormalized cellData. When provided,
 *                   cell values are read from these rows instead of fetching
 *                   from the CellValues API (dramatically faster).
 */
export function useDynamicColumns(boardId: string, seedRows?: SeedRow[], options?: { onCellSaved?: (rowId: string, result: { inviteStatusChanged?: boolean; columnId?: string; value?: DynCellValue }) => void; enabled?: boolean }) {
  // Default true — when enabled is explicitly false, skip all fetching and return empty state
  const isEnabled = options?.enabled !== false;

  // ── Lazy initial state from cache — avoids an empty render on first mount ─
  const [prevBoardId,  setPrevBoardId]  = useState(boardId);
  const [columns,      setColumns]      = useState<DynColumn[]>(() => boardId ? (colCache.get(boardId) ?? []) : []);
  const [cellMap,      setCellMap]      = useState<Map<string, DynCell>>(() => boardId ? (cellMapCache.get(boardId) ?? new Map()) : new Map());
  const [cellsLoading, setCellsLoading] = useState(() => isEnabled && !!boardId && !cellMapCache.has(boardId) && !(seedRows && seedRows.length > 0));
  const [refreshKey,   setRefreshKey]   = useState(0);

  // ── Initial load tracking — gate UI until first fetch completes ────────────
  // Tracks which boardId has completed its first load. Once set, subsequent
  // reloads (softReload, refreshColumns) do NOT reset it — the flag is
  // one-way per boardId and only resets when boardId changes (unless cache hit).
  const [initialLoadedBoard, setInitialLoadedBoard] = useState<string>(() => {
    if (!isEnabled || !boardId) return '';
    // Cache hit at mount: columns are already available
    if (colCache.has(boardId) || preloadedBoards.has(boardId)) return boardId;
    return '';
  });

  // ── Derived state: synchronously apply cache on boardId change ─────────────
  // When boardId changes React re-renders immediately with these new values,
  // so there is never a "frame" where rows exist but columns/cellMap are empty.
  if (prevBoardId !== boardId) {
    setPrevBoardId(boardId);
    setColumns(boardId ? (colCache.get(boardId) ?? []) : []);
    setCellMap(boardId ? (cellMapCache.get(boardId) ?? new Map()) : new Map());
    setCellsLoading(isEnabled && !!boardId && !cellMapCache.has(boardId) && !(seedRows && seedRows.length > 0));
    // Reset initial load tracking — cache hit = instantly loaded
    if (isEnabled && boardId && (colCache.has(boardId) || preloadedBoards.has(boardId))) {
      setInitialLoadedBoard(boardId);
    } else {
      setInitialLoadedBoard('');
    }
  }

  const loadedRef = useRef<string>('');
  const softReloadResolveRef = useRef<(() => void) | null>(null);

  // ── Column widths — sync with localStorage when boardId changes ───────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`col-widths-${boardId}`) ?? '{}'); } catch { return {}; }
  });

  useEffect(() => {
    if (!boardId) { setColWidths({}); return; }
    try { setColWidths(JSON.parse(localStorage.getItem(`col-widths-${boardId}`) ?? '{}')); }
    catch { setColWidths({}); }
  }, [boardId]);

  // ── Seed version: stable key that only changes when actual cellData changes ─
  // Using sum of cellData string lengths — changes only when cells are added/modified.
  // This prevents spurious effect re-runs when rows change for other reasons (name, status, etc.)
  const seedVersion = useMemo(() => {
    if (!seedRows) return -1;
    let v = 0;
    for (const r of seedRows) { if (r.cellData) v += r.cellData.length; }
    return v;
  }, [seedRows]);

  // ── Main effect: load columns + build cell map ─────────────────────────────
  useEffect(() => {
    // Only count a row as having seed data if its cellData is valid JSON that parses
    // to a non-null object with at least one key. Plain `{}` or null must NOT trigger
    // the fast path — it would produce an empty map and block the CellValues API call.
    const isValidCellDataJson = (raw: string | null | undefined): boolean => {
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
      } catch {
        return false;
      }
    };

    const hasSeedData = !!seedRows && seedRows.length > 0 && seedRows.some(r => isValidCellDataJson(r.cellData));

    // When there is no valid seed data, exclude seedVersion from the runKey so that
    // background row refreshes (which change seedVersion) don't cancel the in-flight
    // getCellValues fetch and leave cellsLoading stuck at true forever.
    const runKey = `${boardId}::${refreshKey}::${hasSeedData ? seedVersion : 'api'}`;

    // Skip all fetching when disabled — leave existing cached state untouched
    if (!isEnabled) return;

    if (!boardId) {
      setColumns([]);
      setCellMap(new Map());
      return;
    }
    // Already up to date — skip
    if (loadedRef.current === runKey) return;

    // ── Preloaded-cache fast-exit (rename / duplicate) ───────────────────────
    // If renameBoardCache or preSeedBoardCache already populated the caches for
    // this boardId, apply them immediately and skip the backend fetch entirely.
    // This avoids the race condition where the fetch arrives before the backend
    // has finished migrating records to the new boardId.
    if (preloadedBoards.has(boardId) && colCache.has(boardId)) {
      console.log('[useDynamicColumns] using preloaded cache', { boardId, runKey });
      setColumns(colCache.get(boardId)!);
      const cachedMap = cellMapCache.get(boardId);
      if (cachedMap) setCellMap(cachedMap);
      setCellsLoading(false);
      loadedRef.current = runKey;
      setInitialLoadedBoard(boardId);
      if (softReloadResolveRef.current) { softReloadResolveRef.current(); softReloadResolveRef.current = null; }
      preloadedBoards.delete(boardId);
      return;
    }

    // Apply cached columns immediately (instant on board switch)
    const cachedCols = colCache.get(boardId);
    if (cachedCols) setColumns(cachedCols);

    // ── FAST PATH: build cell map from seedRows synchronously ───────────────
    if (hasSeedData && seedRows) {
      const builtMap = buildMapFromRows(seedRows);
      cellMapCache.set(boardId, builtMap);
      setCellMap(builtMap);
      setCellsLoading(false);
      // Still need to fetch columns if not cached — done in run() below
    } else {
      // Apply cached cell map while we fetch fresh data
      const cachedMap = cellMapCache.get(boardId);
      if (cachedMap) {
        setCellMap(cachedMap);
      } else if (!seedRows || seedRows.length === 0) {
        // Only show loading skeletons when there are NO seedRows at all.
        // When seedRows exist but have empty cellData, skip skeletons —
        // cells will be empty briefly while the API fetches in background,
        // matching the previous behavior before the isValidCellDataJson fix.
        setCellsLoading(true);
      }
    }

    let cancelled = false;

    const run = async () => {
      try {
        // ── Step 1: Fetch columns ────────────────────────────────────────────
        let cols = cachedCols;
        if (!cols) {
          const colsData = await fetchCols(boardId);
          if (cancelled) return;
          cols = colsData.columns;
        }

        // ── Step 2: Seed default columns if this is a known prefix board ─────
        if (cols.length === 0 && !boardId.includes('::')) {
          const matched = BOARD_DEFAULTS.find(b => boardId.startsWith(b.prefix));
          if (matched) {
            for (let i = 0; i < matched.cols.length; i++) {
              const d = matched.cols[i];
              await withColSaveLimit(() => saveBoardColumn({ columnName: d.name, boardId, columnType: d.type, optionsJson: d.options, columnOrder: d.order ?? i }));
            }
            const fresh = await getBoardColumns({ boardId });
            if (cancelled) return;
            cols = fresh.columns;
          }
        }

        if (cancelled) return;
        colCache.set(boardId, cols);
        setColumns(cols);

        // ── Step 3: Cells ────────────────────────────────────────────────────
        if (hasSeedData) {
          // Already built synchronously above — just mark loaded
          loadedRef.current = runKey;
          setInitialLoadedBoard(boardId);
          if (softReloadResolveRef.current) { softReloadResolveRef.current(); softReloadResolveRef.current = null; }
        } else {
          // ── SLOW PATH: paginated CellValues API (fallback when no cellData) ─
          // Retry helper: up to 2 retries with exponential backoff on rate-limit errors.
          // Each failed attempt waits 2s then 4s before giving up.
          const fetchCellPage = async (pageOffset: number) => {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                return await withCellFetchLimit(() => getCellValues({ boardId, limit: 500, offset: pageOffset }));
              } catch (err) {
                if (cancelled) return null;
                const msg = (err as Error)?.message ?? '';
                const isRateLimit = msg.includes('Too many requests') || msg.includes('429');
                if (attempt < 2 && isRateLimit) {
                  await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                  if (cancelled) return null;
                } else {
                  throw err;
                }
              }
            }
            return null;
          };

          let allCells: DynCell[] = [];
          const firstPage = await fetchCellPage(0);
          if (!firstPage || cancelled) return;
          allCells = [...firstPage.cells];
          const firstMap = buildMap(allCells);
          cellMapCache.set(boardId, firstMap);
          setCellMap(firstMap);

          if (firstPage.hasMore) {
            let offset  = firstPage.nextOffset;
            let hasMore: boolean = firstPage.hasMore;
            while (hasMore && !cancelled) {
              const page = await fetchCellPage(offset);
              if (!page || cancelled) return;
              allCells = [...allCells, ...page.cells];
              const partialMap = buildMap(allCells);
              cellMapCache.set(boardId, partialMap);
              setCellMap(partialMap);
              offset  = page.nextOffset;
              hasMore = page.hasMore;
            }
          }

          if (!cancelled) {
            setCellsLoading(false);
            loadedRef.current = runKey;
            setInitialLoadedBoard(boardId);
            if (softReloadResolveRef.current) { softReloadResolveRef.current(); softReloadResolveRef.current = null; }
          }
        }
      } catch (e) {
        console.error('useDynamicColumns error:', e);
        if (!cancelled) setCellsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  // seedVersion in deps: only re-runs when actual cellData changes, not on every row update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, refreshKey, seedVersion, isEnabled]);

  // ── Cell accessors ─────────────────────────────────────────────────────────
  // useCallback with [cellMap] dep so parent memos can track cell changes
  const getCellVal = useCallback(
    (rowId: string, colId: string): DynCell | undefined => cellMap.get(KEY(rowId, colId)),
    [cellMap]
  );

  const setLocalCellVal = (rowId: string, colId: string, value: DynCellValue) => {
    const k = KEY(rowId, colId);
    const existing = cellMap.get(k);
    const entry: DynCell = { id: existing?.id ?? '__local__', boardId, rowId, columnId: colId, ...value };
    setCellMap(prev => {
      const next = new Map(prev).set(k, entry);
      cellMapCache.set(boardId, next);
      return next;
    });
  };

  const setCellVal = async (rowId: string, colId: string, value: DynCellValue) => {
    const k = KEY(rowId, colId);
    const existing = cellMap.get(k);
    const optimistic: DynCell = { id: existing?.id ?? '__opt__', boardId, rowId, columnId: colId, ...value };
    setCellMap(prev => new Map(prev).set(k, optimistic));
    try {
      const result = await saveCellValue({ boardId, rowId, columnId: colId, ...value });
      const saved = { ...optimistic, id: result.id };
      setCellMap(prev => {
        const next = new Map(prev).set(k, saved);
        cellMapCache.set(boardId, next);
        return next;
      });
      options?.onCellSaved?.(rowId, { inviteStatusChanged: result.inviteStatusChanged, columnId: colId, value });
    } catch {
      setCellMap(prev => {
        const next = new Map(prev);
        if (existing) next.set(k, existing); else next.delete(k);
        return next;
      });
    }
  };

  /**
   * Batch-update many cells at once.
   * - Applies ALL optimistic updates in a single setState (one re-render).
   * - Persists to backend in background batches of 50, fire-and-forget.
   * Pass `value: {}` (empty object / undefined fields) to clear a cell.
   */
  const batchSetCellVals = (ops: Array<{ rowId: string; colId: string; value: DynCellValue }>) => {
    if (ops.length === 0) return;

    // 1. Single optimistic update for all ops
    setCellMap(prev => {
      const next = new Map(prev);
      for (const op of ops) {
        const k = KEY(op.rowId, op.colId);
        const existing = prev.get(k);
        const hasAnyValue = op.value.textValue !== undefined || op.value.numberValue !== undefined ||
          op.value.dateValue !== undefined || op.value.booleanValue !== undefined || op.value.fileUrl !== undefined;
        if (hasAnyValue) {
          next.set(k, { id: existing?.id ?? '__opt__', boardId, rowId: op.rowId, columnId: op.colId, ...op.value });
        } else {
          next.delete(k);
        }
      }
      cellMapCache.set(boardId, next);
      return next;
    });

    // 2. Persist to backend via module-level function (survives component unmount)
    persistBatchInBackground(boardId, ops);
  };

  // ── Column mutations ───────────────────────────────────────────────────────
  // Optimistic: shows new column instantly, persists in background.
  const addColumn = (columnName: string, columnType: string, optionsJson?: string, atIndex?: number): Promise<string> => {
    const snapshot = [...columns];
    const sorted = [...columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
    const insertAt = atIndex !== undefined ? atIndex : sorted.length;
    const toShift = sorted.filter(c => (c.columnOrder ?? 0) >= insertAt);

    // 1. Build optimistic column list and update state immediately
    const tempId = `temp-col-${Date.now()}`;
    const tempCol: DynColumn = {
      id: tempId,
      boardId,
      columnName,
      columnType,
      optionsJson,
      columnOrder: insertAt,
    };
    const shifted = sorted.map(c =>
      (c.columnOrder ?? 0) >= insertAt ? { ...c, columnOrder: (c.columnOrder ?? 0) + 1 } : c
    );
    const optimistic = [...shifted, tempCol].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
    setColumns(optimistic);
    colCache.set(boardId, optimistic);

    // 2. Create the real column FIRST — antes esto resequenciaba las columnas
    // corridas primero y creaba la nueva al final, dejándola con un id
    // temporal (sin existir en el servidor) durante todo ese reacomodo en
    // serie. Cualquier interacción con la columna en esa ventana (escribir
    // en una celda, renombrarla) apuntaba a un id que el backend no conocía
    // y se perdía. Crearla primero reduce esa ventana a una sola llamada.
    const savePromise = (async (): Promise<string> => {
      let realId: string;
      try {
        const result = await withColSaveLimit(() =>
          saveBoardColumn({ columnName, boardId, columnType, optionsJson, columnOrder: insertAt })
        );
        realId = result.id;
      } catch (err) {
        // Rollback to pre-add state — la columna nunca llegó a existir de verdad
        setColumns(snapshot);
        colCache.set(boardId, snapshot);
        toast.error('Error al crear columna');
        throw err;
      }

      // Swap temp ID → real ID in columns state (preserves list structure, no full re-fetch)
      setColumns(prev => {
        const updated = prev.map(c => c.id === tempId ? { ...c, id: realId } : c);
        colCache.set(boardId, updated);
        return updated;
      });

      // Remap any cells assigned to temp column ID → real column ID
      setCellMap(prev => {
        let changed = false;
        const next = new Map<string, DynCell>();
        for (const [key, cell] of prev) {
          if (cell.columnId === tempId) {
            changed = true;
            const newKey = KEY(cell.rowId!, realId);
            next.set(newKey, { ...cell, columnId: realId });
          } else {
            next.set(key, cell);
          }
        }
        if (changed) cellMapCache.set(boardId, next);
        return changed ? next : prev;
      });

      // 3. Reorder the shifted columns afterward, as trailing background
      // cleanup — the new column already exists and is fully usable at this
      // point regardless of how long this takes or whether it fails.
      if (toShift.length > 0) {
        (async () => {
          try {
            for (const c of toShift) {
              await withColSaveLimit(() =>
                saveBoardColumn({ id: c.id, columnName: c.columnName ?? '', boardId, columnType: c.columnType ?? '', optionsJson: c.optionsJson, columnOrder: (c.columnOrder ?? 0) + 1 })
              );
            }
          } catch {
            toast.error('No se pudo reacomodar el resto de las columnas');
          }
        })();
      }

      return realId;
    })();

    return savePromise;
  };

  // Optimistic: removes column instantly, restores on error.
  const removeColumn = async (colId: string) => {
    const snapshot = [...columns];
    const updated = columns.filter(c => c.id !== colId);
    setColumns(updated);
    colCache.set(boardId, updated);
    try {
      await deleteBoardColumn({ id: colId });
    } catch {
      setColumns(snapshot);
      colCache.set(boardId, snapshot);
      toast.error('Error al eliminar columna');
    }
  };

  const renameColumn = async (colId: string, newName: string) => {
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    const updated = columns.map(c => c.id === colId ? { ...c, columnName: newName } : c);
    setColumns(updated);
    colCache.set(boardId, updated);
    await withColSaveLimit(() => saveBoardColumn({ id: colId, columnName: newName, boardId, columnType: col.columnType, optionsJson: col.optionsJson, columnOrder: col.columnOrder }));
  };

  const updateColumn = async (colId: string, updates: { columnName?: string; columnType?: string; optionsJson?: string }) => {
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    const merged = { ...col, ...updates };
    const updated = columns.map(c => c.id === colId ? merged : c);
    setColumns(updated);
    colCache.set(boardId, updated);
    await withColSaveLimit(() => saveBoardColumn({
      id: colId,
      columnName: merged.columnName ?? col.columnName ?? '',
      boardId,
      columnType: merged.columnType ?? col.columnType ?? '',
      optionsJson: merged.optionsJson ?? col.optionsJson,
      columnOrder: merged.columnOrder ?? col.columnOrder ?? 0,
    }));
  };

  const reorderColumns = async (dragId: string, dropId: string, side: 'left' | 'right') => {
    const sorted = [...columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
    const dragIdx = sorted.findIndex(c => c.id === dragId);
    if (dragIdx === -1 || dragId === dropId) return;
    const [dragged] = sorted.splice(dragIdx, 1);
    let dropIdx = sorted.findIndex(c => c.id === dropId);
    if (side === 'right') dropIdx += 1;
    sorted.splice(dropIdx, 0, dragged);
    const reordered = sorted.map((c, i) => ({ ...c, columnOrder: i }));
    setColumns(reordered);
    colCache.set(boardId, reordered);
    // Only persist columns whose order actually changed
    const oldOrderMap = new Map(columns.map(c => [c.id, c.columnOrder ?? 0]));
    const changed = reordered.filter(c => (c.columnOrder ?? 0) !== (oldOrderMap.get(c.id) ?? -1));
    try {
      for (const c of changed) {
        await withColSaveLimit(() => saveBoardColumn({ id: c.id, columnName: c.columnName ?? '', boardId, columnType: c.columnType ?? '', optionsJson: c.optionsJson, columnOrder: c.columnOrder ?? 0 }));
      }
    } catch {
      toast.error('Error al guardar el orden de columnas');
    }
  };

  // ── Column resize ──────────────────────────────────────────────────────────

  // Compute smart default widths once when columns or cell data changes
  const smartDefaults = useMemo(() => {
    const TYPE_MIN_WIDTHS: Record<string, number> = {
      'Checkbox': 70, 'Rating': 100, 'Color': 110, 'Status': 140, 'Select': 140,
      'Fecha': 130, 'Datetime': 160, 'Número': 100, 'Persona': 150, 'Botón': 130,
      'Fórmula': 120, 'Texto': 160, 'Email': 180, 'Teléfono': 140, 'Archivo': 160,
      'Barra': 130,
    };

    // Single pass through cellMap to collect content samples per column (max 20 per col)
    const samples: Record<string, string[]> = {};
    for (const [key, cell] of cellMap) {
      const colId = key.split('::')[1];
      if (!colId) continue;
      if (!samples[colId]) samples[colId] = [];
      if (samples[colId].length >= 20) continue;
      let text = '';
      if (cell.textValue) text = cell.textValue;
      else if (cell.numberValue != null) text = String(cell.numberValue);
      else if (cell.dateValue) text = cell.dateValue.split('T')[0];
      if (!text) continue;
      samples[colId].push(text);
    }

    const defaults: Record<string, number> = {};
    for (const col of columns) {
      // +130 (no +60): el header trae grip + ícono de tipo + botón de orden +
      // filtro + menú "···" (px-2 + 5 elementos con sus gaps, ~126px reales)
      // antes de llegar al texto — con +60 el nombre se truncaba incluso en
      // columnas nuevas con nombres cortos, porque los íconos ya se comían
      // el ancho calculado.
      const headerWidth = (col.columnName ?? '').length * 8 + 130;
      const typeMinWidth = TYPE_MIN_WIDTHS[col.columnType ?? ''] ?? 160;

      let maxSampleWidth = 0;
      const colSamples = samples[col.id];
      if (colSamples) {
        for (const text of colSamples) {
          const truncLen = Math.min(text.length, 40);
          const sw = truncLen * 7 + 40;
          if (sw > maxSampleWidth) maxSampleWidth = sw;
        }
      }

      const calculated = Math.max(headerWidth, typeMinWidth, maxSampleWidth);
      // Tope subido de 340 a 420 — nombres de columna reales de >40 caracteres
      // (ej. "CALENDARIO DE MICROSESIONES Y TRIADAS (PERÚ)") se truncaban sí o
      // sí con el tope viejo. Sigue habiendo un tope (no queremos que un solo
      // nombre larguísimo vuelva la tabla completa inmanejable) — para lo que
      // ni así quepa, el título completo sigue disponible en el tooltip.
      defaults[col.id] = Math.min(Math.max(calculated, 70), 420);
    }
    return defaults;
  }, [columns, cellMap]);

  const getColWidth = (colId: string) => colWidths[colId] ?? smartDefaults[colId] ?? 140;

  const startResize = (colId: string, startX: number) => {
    const startWidth = colWidths[colId] ?? 140;
    const key = `col-widths-${boardId}`;
    let currentW = startWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
      currentW = Math.min(800, Math.max(40, startWidth + e.clientX - startX));
      // Mutate DOM directly — no setState, no re-render
      const colEl = document.querySelector(`col[data-col-id="${colId}"]`) as HTMLElement | null;
      if (colEl) {
        colEl.style.width = `${currentW}px`;
        colEl.style.minWidth = `${currentW}px`;
        colEl.style.maxWidth = `${currentW}px`;
      }
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Single setState + localStorage write only on release
      setColWidths(prev => {
        const next = { ...prev, [colId]: currentW };
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const visibleColumns = columns.filter(c => c.columnType !== '__fillout_link__' && c.columnType !== '__linked_group__');
  const linkCol = columns.find(c => c.columnType === '__fillout_link__');
  const linkedFormInfo: { formId: string; formName: string; linkedAt: string } | null = linkCol?.optionsJson
    ? (() => { try { return JSON.parse(linkCol.optionsJson); } catch { return null; } })()
    : null;

  const reload = () => {
    colCache.delete(boardId);
    cellMapCache.delete(boardId);
    loadedRef.current = '';
    setRefreshKey(k => k + 1);
  };

  const softReload = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      softReloadResolveRef.current = resolve;
      loadedRef.current = '';
      setRefreshKey(k => k + 1);
    });
  };

  /** Fetch fresh columns from the server without touching cell cache or showing skeletons.
   *  Ideal for group structure changes where columns change but cells don't. */
  const refreshColumns = async () => {
    if (!boardId) return;
    try {
      const colsData = await fetchCols(boardId);
      colCache.set(boardId, colsData.columns);
      setColumns(colsData.columns);
    } catch (e) {
      console.error('[useDynamicColumns] refreshColumns error:', e);
    }
  };

  return {
    columns: visibleColumns,
    linkedFormInfo,
    reload,
    softReload,
    refreshColumns,
    getCellVal,
    setCellVal,
    batchSetCellVals,
    addColumn,
    removeColumn,
    renameColumn,
    updateColumn,
    reorderColumns,
    loading: false,       // columns apply instantly from cache
    cellsLoading,
    hasInitiallyLoaded: initialLoadedBoard === boardId,
    getColWidth,
    startResize,
    setLocalCellVal,
  };
}
