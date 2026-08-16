import React, { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useProject } from '../context/ProjectContext';
import { useRealtimeBoardEvents, BoardFieldUpdatedPayload } from '../hooks/useRealtimeBoardEvents';
import { useProjectPresence } from '../hooks/useProjectPresence';
import { ProjectPresenceAvatars } from '../components/ProjectPresenceAvatars';
import { getRecruitmentRows, saveRecruitmentRow, deleteRecruitmentRow, markNDASent, GetRecruitmentRowsOutputType, getFilloutForms, linkFilloutForm, GetFilloutFormsOutputType, searchParticipantHistory, SearchParticipantHistoryOutputType, syncFilloutResponses, checkNewSubmissions, countFilloutSubmissions, deleteBoard, saveBoard, saveInternalView, reorderRecruitmentRows, duplicateRows, duplicateGroup, getLinkedEventsInfo, linkGroupToEvent, saveCalendarEvent, getTasks, getBoardDuplicateBadges, GetBoardDuplicateBadgesOutputType, publishRecruitmentGroupsChanged, publishRecruitmentRowsChanged, renameBoard } from 'zite-endpoints-sdk';
import { CreateEventDialog } from '../components/CreateEventDialog';
import { TrashSheet } from '../components/TrashSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { ColumnFilterPopover } from '../components/ColumnFilterPopover';
import { AdvancedFilterSheet } from '../components/AdvancedFilterSheet';
import { DuplicateSearchDialog } from '../components/DuplicateSearchDialog';
import { useTableFilters } from '../hooks/useTableFilters';
import { useDynamicColumns, isBoardCached, renameBoardCache } from '../hooks/useDynamicColumns';
import type { DynCellValue } from '../hooks/useDynamicColumns';
import { DynamicColumnHeaders, DynamicColumnCells, type DynCols } from '../components/DynamicColumns';
import { GROUP_COLORS, getGroupColor, useResizableCol, dynColToFilterCol, cellDisplayValue } from '../components/table/tableUtils';
import { InlineInput } from '../components/table/InlineInput';
import { GroupPicker } from '../components/table/GroupPicker';
import { GroupSectionHeader } from '../components/table/GroupSectionHeader';
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, FileText, X, AlertTriangle, SearchCheck, FolderPlus, GripVertical, Link2, CheckCircle2, Copy, Clock, RefreshCw, Mail, User, Phone, Layers, ExternalLink, Share2, Eye, EyeOff, Save, Upload, ArrowUpDown, ClipboardCopy, ChevronsDownUp, ChevronsUpDown, BarChart3, Search, Download, ClipboardList } from 'lucide-react';
import RecruitmentStatusPanel from '../components/RecruitmentStatusPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { SharedViewDialog } from '../components/SharedViewDialog';
import { ExcelImportDialog } from '../components/ExcelImportDialog';
import { InternalViewsBar, InternalViewsBarHandle } from '../components/InternalViewsBar';
import { GetInternalViewsOutputType } from 'zite-endpoints-sdk';
import { BoardTabsBar } from '../components/pm/BoardTabsBar';
import type { BoardObj } from '../components/pm/pmTypes';

type InternalView = GetInternalViewsOutputType['views'][0];

type Row = GetRecruitmentRowsOutputType['rows'][0];
type RowBadgeInfo = GetBoardDuplicateBadgesOutputType['badges'][string];
const rowsCache = new Map<string, Row[]>();
const prefetchInFlight = new Set<string>();
const statuses = ['Pendiente', 'Contactado', 'Confirmado', 'Asistió', 'No show', 'Descartado'];
const emptyForm = { rowName: '', participantName: '', email: '', phone: '', idNumber: '', status: 'Pendiente', notes: '', boardName: '' };

const RECRUIT_COLS = [
  { key: 'participantName', label: 'Participante', type: 'text'   as const },
  { key: 'email',           label: 'Email',        type: 'text'   as const },
  { key: 'phone',           label: 'Teléfono',     type: 'text'   as const },
  { key: 'idNumber',        label: 'ID / Doc',     type: 'text'   as const },
  { key: 'status',          label: 'Estado',       type: 'select' as const, options: statuses },
];

// Las 3 capas de detección de duplicados (ver getBoardDuplicateBadges.ts), expuestas
// como columnas fijas/filtrables — "Sí" siempre significa "hay señal/hay que revisar".
const DUP_BADGE_COLS = [
  { key: '_dupBoard'   as const, label: 'Este filtro',       type: 'select' as const, options: ['Sí', 'No'] },
  { key: '_dupHistory' as const, label: 'Otros formularios', type: 'select' as const, options: ['Sí', 'No'] },
  { key: '_dupRisk'    as const, label: 'Elegibilidad',      type: 'select' as const, options: ['Sí', 'No'] },
];

function dupBadgeValue(rowId: string, key: '_dupBoard' | '_dupHistory' | '_dupRisk', badgeMap: Record<string, RowBadgeInfo>): 'Sí' | 'No' {
  const b = badgeMap[rowId];
  if (!b) return 'No';
  if (key === '_dupBoard')   return b.sameBoardCount > 1 ? 'Sí' : 'No';
  if (key === '_dupHistory') return b.signals.some(s => s === 'old' || s === 'registered_only') ? 'Sí' : 'No';
  return b.hasHighRisk ? 'Sí' : 'No';
}



// ── CSV Export Helper ─────────────────────────────────────────────────────────
function escapeCsvCell(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportRecruitmentCsv(
  rows: Row[],
  hiddenColumns: Set<string>,
  dynCols: DynCols,
  groupDynCols: DynCols,
) {
  // Build ordered list of visible columns
  const fixedCols: { key: string; label: string }[] = [
    { key: 'participantName', label: 'Participante' },
  ];
  if (!hiddenColumns.has('email'))    fixedCols.push({ key: 'email',    label: 'Email' });
  if (!hiddenColumns.has('phone'))    fixedCols.push({ key: 'phone',    label: 'Teléfono' });
  if (!hiddenColumns.has('idNumber')) fixedCols.push({ key: 'idNumber', label: 'ID / Doc' });
  if (!hiddenColumns.has('status'))   fixedCols.push({ key: 'status',   label: 'Estado' });

  const visibleDyn = [...dynCols.columns]
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0))
    .filter(c => !hiddenColumns.has(c.id));

  // Header row — include "Grupo" after fixed cols
  const headers = [
    ...fixedCols.map(c => c.label),
    'Grupo',
    ...visibleDyn.map(c => c.columnName ?? ''),
  ];

  // Determine group for each top-level row
  const topLevel = rows.filter(r => !r.parentRowId);
  const rowGroupMap = new Map<string, { groupId: string; groupName: string }>();
  for (const row of topLevel) {
    for (const g of groupDynCols.columns) {
      if (groupDynCols.getCellVal(row.id, g.id)?.textValue === '1') {
        rowGroupMap.set(row.id, { groupId: g.id, groupName: g.columnName ?? 'Sin nombre' });
        break;
      }
    }
  }

  // Sort rows by group order (named groups first in column order, then "Sin grupo")
  const groupOrder = new Map<string, number>();
  groupDynCols.columns.forEach((g, i) => groupOrder.set(g.id, i));
  const NO_GROUP_ORDER = groupDynCols.columns.length;

  const sorted = [...topLevel].sort((a, b) => {
    const ga = rowGroupMap.get(a.id);
    const gb = rowGroupMap.get(b.id);
    const oa = ga ? (groupOrder.get(ga.groupId) ?? NO_GROUP_ORDER) : NO_GROUP_ORDER;
    const ob = gb ? (groupOrder.get(gb.groupId) ?? NO_GROUP_ORDER) : NO_GROUP_ORDER;
    return oa - ob;
  });

  // Data rows
  const dataRows = sorted.map(row => {
    const fixed = fixedCols.map(c => {
      if (c.key === 'participantName') return row.participantName || row.rowName || '';
      return ((row as Record<string, unknown>)[c.key] as string) ?? '';
    });
    const groupName = rowGroupMap.get(row.id)?.groupName ?? 'Sin grupo';
    const dynamic = visibleDyn.map(c => {
      return cellDisplayValue(dynCols.getCellVal(row.id, c.id), c.columnType) ?? '';
    });
    return [...fixed, groupName, ...dynamic];
  });

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...dataRows.map(r => r.map(escapeCsvCell).join(',')),
  ].join('\n');

  // BOM for Excel UTF-8 compat
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reclutamiento-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Recruitment Table ─────────────────────────────────────────────────────────
const RecruitmentTable = memo(function RecruitmentTable({ rows, onSaveName, onSaveField, onEdit, onDelete, onBulkDelete, onUpdateStatus, onSendNDA, onQuickCreate, onCreateGroup, dynCols, groupDynCols, columnFilters, setColFilter, colUniqueValues, onDuplicateClick, badgeMap, hiddenColumns, onRowsChange, sortColumn, sortDirection, toggleSort, onDuplicateGroup, onGroupStructureChanged, onRefresh, linkedEventsMap, projectCode, recruitmentBoardId, onLinkedEventsRefresh, onCreateEventForGroup, expandedGroups, setExpandedGroups, activeGroupFilter }: {
  rows: Row[];
  onSaveName: (id: string, name: string) => void;
  onSaveField: (id: string, field: 'email' | 'phone' | 'idNumber', value: string) => void;
  onEdit: (row: Row) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onUpdateStatus: (id: string, status: string) => void;
  onSendNDA: (id: string) => void;
  onQuickCreate: (name: string, groupId?: string) => void;
  onCreateGroup: () => void;
  dynCols: DynCols; groupDynCols: DynCols;
  columnFilters: Record<string, Set<string>>;
  setColFilter: (col: string, vals: Set<string>) => void;
  colUniqueValues: (col: string) => string[];
  onDuplicateClick: (row: Row) => void;
  badgeMap: Record<string, RowBadgeInfo>;
  hiddenColumns: Set<string>;
  onRowsChange: React.Dispatch<React.SetStateAction<Row[]>>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  toggleSort: (columnKey: string) => void;
  onDuplicateGroup?: (groupId: string) => void;
  onGroupStructureChanged?: () => void;
  onRefresh?: () => void;
  linkedEventsMap?: Record<string, { eventName?: string; eventDate?: string; durationHours?: number; location?: string }>;
  projectCode?: string;
  recruitmentBoardId?: string;
  onLinkedEventsRefresh?: () => void;
  onCreateEventForGroup?: (groupId: string) => Promise<void>;
  expandedGroups: Set<string>;
  setExpandedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeGroupFilter: Set<string> | null;
}) {
  // ↑ signature unchanged — refactored to single <table> for correct sticky headers
  const [editingName,    setEditingName]    = useState<string | null>(null);
  const [editingField,   setEditingField]   = useState<{ id: string; field: 'email' | 'phone' | 'idNumber' } | null>(null);
  const [newRowNames,    setNewRowNames]    = useState<Record<string, string>>({});
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [duplicating,    setDuplicating]    = useState(false);
  const [dragGroupId,    setDragGroupId]    = useState<string | null>(null);
  const [dropTargetId,   setDropTargetId]   = useState<string | null>(null);
  const [dragRowId,      setDragRowId]      = useState<string | null>(null);
  const [dropRowGroupId, setDropRowGroupId] = useState<string | null>(null);

  const [visibleDynColIds, setVisibleDynColIds] = useState<Set<string> | null>(null);
  const colVisRafRef = useRef<number | null>(null);

  // ── Vertical virtualization for Sin grupo (Performance Mode) ──────────────
  const ROW_HEIGHT    = 36;
  const VIRT_BUFFER   = 25;
  const VIRT_THRESHOLD = 100;
  const [noneVirtRange, setNoneVirtRange] = useState({ start: 0, end: 80 });
  const noneGroupSentinelRef = useRef<HTMLTableRowElement>(null);
  const noneVirtRafRef = useRef<number | null>(null);
  const noneRowCountRef = useRef(0);

  const dropRowGroupRef = useRef<string | null>(null);
  // Overlay DnD — no DOM mutations during drag, uses absolute <div> + midpoint geometry
  const dropTargetRef  = useRef<{ rowId: string; position: 'before' | 'after' } | null>(null);
  const dropLineRef    = useRef<HTMLDivElement>(null);
  const dragRowIdRef   = useRef<string | null>(null);
  const dragClientYRef = useRef<number>(0);
  const rafIdRef       = useRef<number | null>(null);

  const hideDropLine = () => {
    if (dropLineRef.current) dropLineRef.current.style.opacity = '0';
  };
  const cancelRaf = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };
  const nameCol    = useResizableCol('recruit-name-col',    220, 120);
  const dupBoardColW   = useResizableCol('recruit-col-dupboard',   52, 40);
  const dupHistoryColW = useResizableCol('recruit-col-duphistory', 52, 40);
  const dupRiskColW    = useResizableCol('recruit-col-duprisk',    52, 40);
  const emailColW  = useResizableCol('recruit-col-email',   180, 80);
  const phoneColW  = useResizableCol('recruit-col-phone',   130, 80);
  const idNumColW  = useResizableCol('recruit-col-idnum',   120, 80);
  const statusColW = useResizableCol('recruit-col-status',  140, 80);
  const ndaColW    = useResizableCol('recruit-col-nda',      90, 80);

  // Left offsets for the 3 pinned badge columns — contiguous to the right of
  // "Participante", accounting for whichever of the 3 are currently hidden.
  const dupBoardLeft   = 35 + nameCol.width;
  const dupHistoryLeft = dupBoardLeft   + (!hiddenColumns.has('_dupBoard')   ? dupBoardColW.width   : 0);
  const dupRiskLeft    = dupHistoryLeft + (!hiddenColumns.has('_dupHistory') ? dupHistoryColW.width : 0);

  const seenGroupIds = useRef(new Set<string>(['__none__']));
  const groupColIds = groupDynCols.columns.map(c => c.id).join(',');
  useEffect(() => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      groupDynCols.columns.forEach(g => { if (!seenGroupIds.current.has(g.id)) { n.add(g.id); seenGroupIds.current.add(g.id); } });
      return n;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupColIds]);

  // useCallback aquí no es cosmético: DynamicColumnCells está memoizado y su
  // prop onBulkSave depende de esto — si se recrea en cada render (el patrón
  // de antes), el memo nunca hace bail-out y se pierde el punto de memoizar.
  const toggleSelect = useCallback((id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const groups    = groupDynCols.columns;

  const showBulkConfirm = useCallback((label: string, applyAll: () => void) => {
    if (selectedIds.size <= 1) return;
    toast(`¿Aplicar a las ${selectedIds.size} filas seleccionadas?`, {
      description: `"${label}"`,
      action: { label: 'Aplicar a todas', onClick: applyAll },
      cancel: { label: 'Solo esta fila', onClick: () => {} },
      duration: 5000,
    });
  }, [selectedIds]);

  // Handler estable para DynamicColumnCells.onBulkSave. DynamicColumnCells.onBulkSave
  // tiene la forma (colId, value, label) => void — no recibe rowId — así que
  // cada fila necesita su propio wrapper que capture su rowId. Para que ese
  // wrapper no rompa la memoización (una función nueva cada render invalidaría
  // el memo de DynamicColumnCells), se cachea uno por fila en un ref y se lee
  // la versión más reciente de la lógica real vía otro ref, evitando closures
  // obsoletas (`selectedIds` desactualizado) sin tener que invalidar el cache.
  const handleBulkSaveDynCol = useCallback((rowId: string, colId: string, value: DynCellValue, label: string) => {
    showBulkConfirm(label, () => {
      const ops = [...selectedIds].filter(id => id !== rowId).map(id => ({ rowId: id, colId, value }));
      if (ops.length > 0) dynCols.batchSetCellVals(ops);
    });
  }, [showBulkConfirm, selectedIds, dynCols]);
  const handleBulkSaveDynColRef = useRef(handleBulkSaveDynCol);
  handleBulkSaveDynColRef.current = handleBulkSaveDynCol;
  const bulkSaveHandlersRef = useRef(new Map<string, (colId: string, value: DynCellValue, label: string) => void>());
  const getBulkSaveHandler = useCallback((rowId: string) => {
    let fn = bulkSaveHandlersRef.current.get(rowId);
    if (!fn) {
      fn = (colId, value, label) => handleBulkSaveDynColRef.current(rowId, colId, value, label);
      bulkSaveHandlersRef.current.set(rowId, fn);
    }
    return fn;
  }, []);

  // Sort rows by column when sortColumn is active
  const recentColors = useMemo(() => {
    const colorCols = dynCols.columns.filter(c => c.columnType === 'Color');
    if (!colorCols.length) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of rows) {
      for (const col of colorCols) {
        const hex = dynCols.getCellVal(row.id, col.id)?.textValue;
        if (hex && !seen.has(hex)) { seen.add(hex); result.push(hex); }
        if (result.length >= 10) return result;
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynCols.columns, dynCols.getCellVal, rows]);

  const sortedTopLevel = useMemo(() => {
    const topLevelRows = rows.filter(r => !r.parentRowId);
    if (!sortColumn) return topLevelRows;
    return [...topLevelRows].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';
      if (sortColumn === 'participantName') {
        aVal = (a.participantName || a.rowName || '').toLowerCase();
        bVal = (b.participantName || b.rowName || '').toLowerCase();
      } else if (['email', 'phone', 'idNumber', 'status'].includes(sortColumn)) {
        aVal = ((a[sortColumn as keyof Row] as string) || '').toLowerCase();
        bVal = ((b[sortColumn as keyof Row] as string) || '').toLowerCase();
      } else if (sortColumn === '_dupBoard' || sortColumn === '_dupHistory' || sortColumn === '_dupRisk') {
        aVal = dupBadgeValue(a.id, sortColumn, badgeMap);
        bVal = dupBadgeValue(b.id, sortColumn, badgeMap);
      } else {
        const col = dynCols.columns.find(c => c.id === sortColumn);
        const aCell = dynCols.getCellVal(a.id, sortColumn);
        const bCell = dynCols.getCellVal(b.id, sortColumn);
        const aStr = cellDisplayValue(aCell, col?.columnType) || '';
        const bStr = cellDisplayValue(bCell, col?.columnType) || '';
        aVal = aStr.toLowerCase();
        bVal = bStr.toLowerCase();
      }
      if (!aVal && bVal) return 1;
      if (aVal && !bVal) return -1;
      if (!aVal && !bVal) return 0;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortColumn, sortDirection, dynCols.getCellVal, dynCols.columns, badgeMap]);

  const topLevel    = sortedTopLevel;

  const sortedDynCols = [...dynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
  const visibleDynCols = sortedDynCols.filter(c => !hiddenColumns.has(c.id));
  const visibleFixedCount = 5 - ['email', 'phone', 'idNumber', 'status', 'nda'].filter(k => hiddenColumns.has(k)).length;
  const visibleBadgeCount = 3 - ['_dupBoard', '_dupHistory', '_dupRisk'].filter(k => hiddenColumns.has(k)).length;
  // 2 always-visible (checkbox + name) + visible badge cols + visible fixed cols + visible dyn cols + 1 trailing
  const totalCols = 3 + visibleBadgeCount + visibleFixedCount + visibleDynCols.length;

  // ── Horizontal column virtualization ──────────────────────────────────────
  // ≤ 30 visible dynamic columns → disable virtualization entirely (render all).
  // > 30 columns → pixel-based buffer ensures partially-visible columns always
  // render their content. null = "show all" (init state + fallback).
  // Bajado de 200 a 30: con muchas columnas dinámicas (común en tableros de
  // reclutamiento), cada fila renderizada de más multiplica el costo por
  // fila — el umbral anterior dejaba boards típicos sin virtualizar nunca.
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    if (visibleDynCols.length <= 30) {
      setVisibleDynColIds(null);
      return; // no scroll listener needed
    }

    // Pixel buffer: any column whose bounds intersect the viewport ± BUFFER_PX
    // is considered visible. 2000 px ≈ 10–15 average columns — prevents flicker
    // on fast lateral scrolling while still limiting DOM for very wide tables.
    const BUFFER_PX = 2000;

    const computeVisible = () => {
      if (visibleDynCols.length === 0) { setVisibleDynColIds(null); return; }

      // Offset where dynamic columns start (after all fixed/sticky columns)
      let fixedW = 32 + nameCol.width;
      if (!hiddenColumns.has('_dupBoard'))   fixedW += dupBoardColW.width;
      if (!hiddenColumns.has('_dupHistory')) fixedW += dupHistoryColW.width;
      if (!hiddenColumns.has('_dupRisk'))    fixedW += dupRiskColW.width;
      if (!hiddenColumns.has('email'))    fixedW += emailColW.width;
      if (!hiddenColumns.has('phone'))    fixedW += phoneColW.width;
      if (!hiddenColumns.has('idNumber')) fixedW += idNumColW.width;
      if (!hiddenColumns.has('status'))   fixedW += statusColW.width;
      if (!hiddenColumns.has('nda'))      fixedW += ndaColW.width;

      const sl          = container.scrollLeft;
      const viewportEnd = sl + container.clientWidth;

      const visibleIds = new Set<string>();
      let offset = fixedW;

      for (const col of visibleDynCols) {
        const w        = dynCols.getColWidth(col.id);
        const colStart = offset;
        const colEnd   = offset + w;
        // Visible if any part of the column intersects the buffered viewport:
        //   colEnd   >= sl          - BUFFER_PX  (right edge within left buffer)
        //   colStart <= viewportEnd + BUFFER_PX  (left edge within right buffer)
        if (colEnd >= sl - BUFFER_PX && colStart <= viewportEnd + BUFFER_PX) {
          visibleIds.add(col.id);
        }
        offset += w;
      }

      // Fallback: if nothing matched (extreme scroll state), show everything
      setVisibleDynColIds(visibleIds.size > 0 ? visibleIds : null);
    };

    const onScroll = () => {
      if (colVisRafRef.current !== null) return;
      colVisRafRef.current = requestAnimationFrame(() => { colVisRafRef.current = null; computeVisible(); });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    computeVisible(); // initial pass

    return () => {
      container.removeEventListener('scroll', onScroll);
      if (colVisRafRef.current !== null) { cancelAnimationFrame(colVisRafRef.current); colVisRafRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleDynCols.length, nameCol.width, dupBoardColW.width, dupHistoryColW.width, dupRiskColW.width, emailColW.width, phoneColW.width, idNumColW.width, statusColW.width, ndaColW.width, hiddenColumns]);

  // ── Vertical virtualization: compute which Sin grupo rows are in-viewport ──
  const computeNoneVirtRange = useCallback(() => {
    const container = tableContainerRef.current;
    const sentinel  = noneGroupSentinelRef.current;
    if (!container || !sentinel) return;
    const cRect      = container.getBoundingClientRect();
    const sRect      = sentinel.getBoundingClientRect();
    const sectionTop = sRect.top - cRect.top + container.scrollTop;
    const relScroll  = container.scrollTop - sectionTop;
    const totalRows  = noneRowCountRef.current;
    const sectionH   = totalRows * ROW_HEIGHT;
    const FREEZE_MARGIN = 200;

    // If viewport has scrolled past "Sin grupo" entirely, freeze the range.
    // This prevents layout thrashing from spacer height oscillation that causes
    // the scroll-jump feedback loop when named groups are below "Sin grupo".
    if (totalRows > 0 && relScroll > sectionH + FREEZE_MARGIN) {
      setNoneVirtRange(prev => {
        if (prev.start === totalRows && prev.end === totalRows) return prev;
        return { start: totalRows, end: totalRows };
      });
      return;
    }

    const visStart   = Math.floor(relScroll / ROW_HEIGHT);
    const visCount   = Math.ceil(container.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, visStart - VIRT_BUFFER);
    const end   = Math.min(totalRows, visStart + visCount + VIRT_BUFFER);
    setNoneVirtRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach scroll listener for vertical virtualization
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      if (noneVirtRafRef.current !== null) return;
      noneVirtRafRef.current = requestAnimationFrame(() => {
        noneVirtRafRef.current = null;
        computeNoneVirtRange();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (noneVirtRafRef.current !== null) { cancelAnimationFrame(noneVirtRafRef.current); noneVirtRafRef.current = null; }
    };
  }, [computeNoneVirtRange]);

  // Recompute after rows or group expansion changes (DOM layout shifts)
  useEffect(() => {
    const id = requestAnimationFrame(computeNoneVirtRange);
    return () => cancelAnimationFrame(id);
  }, [rows.length, expandedGroups.size, computeNoneVirtRange]);

  const rowGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of topLevel) {
      for (const g of groups) {
        if (groupDynCols.getCellVal(r.id, g.id)?.textValue === '1') {
          map.set(r.id, g.id);
          break;
        }
      }
    }
    return map;
  }, [topLevel, groups, groupDynCols.getCellVal]);

  const getRowGroupId = (rowId: string) => rowGroupMap.get(rowId) ?? null;

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = { __none__: [] };
    for (const gr of groups) g[gr.id] = [];
    for (const r of topLevel) {
      const gid = rowGroupMap.get(r.id) ?? null;
      if (gid && g[gid]) g[gid].push(r);
      else g.__none__.push(r);
    }
    return g;
  }, [topLevel, groups, rowGroupMap]);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const moveRowToGroup = (rowId: string, targetGroupId: string) => {
    const currentGroupId = getRowGroupId(rowId);
    if (currentGroupId === targetGroupId) return;
    const ops: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
    // Clear all current group assignments
    for (const g of groups) {
      if (groupDynCols.getCellVal(rowId, g.id)?.textValue === '1') {
        ops.push({ rowId, colId: g.id, value: {} });
      }
    }
    // Set new group
    if (targetGroupId !== '__none__') {
      ops.push({ rowId, colId: targetGroupId, value: { textValue: '1' } });
    }
    groupDynCols.batchSetCellVals(ops);
    // Place the row at the bottom of the target group
    if (targetGroupId !== '__none__') {
      const targetGroupRows = grouped[targetGroupId] ?? [];
      const maxOrder = targetGroupRows.length > 0
        ? Math.max(...targetGroupRows.map(r => r.rowOrder ?? 0)) + 1000
        : 1000;
      onRowsChange(prev => prev.map(r => r.id === rowId ? { ...r, rowOrder: maxOrder } : r));
      reorderRecruitmentRows({ updates: [{ id: rowId, rowOrder: maxOrder }] }).catch(() => {});
    }
    toast.success('Participante movido al grupo');
    publishRecruitmentGroupsChanged({ projectCode: projectCode ?? '', changeType: 'membership' }).catch(() => {});
  };

  // Handle dropping a row onto another row (reorder within group or move + reorder across groups)
  const handleRowOnRowDrop = async (draggedId: string, targetRow: Row, position: 'before' | 'after') => {
    const targetGroupId = getRowGroupId(targetRow.id) ?? '__none__';
    const draggedGroupId = getRowGroupId(draggedId) ?? '__none__';
    const draggedRow = topLevel.find(r => r.id === draggedId);
    if (!draggedRow) return;

    // Build sorted rows in target group, excluding the dragged row
    const sortedGroup = [...(grouped[targetGroupId] ?? [])]
      .sort((a, b) => (a.rowOrder ?? 0) - (b.rowOrder ?? 0))
      .filter(r => r.id !== draggedId);

    const targetIdx = sortedGroup.findIndex(r => r.id === targetRow.id);
    const insertIdx = position === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
    sortedGroup.splice(insertIdx, 0, { ...draggedRow });

    const updates = sortedGroup.map((r, i) => ({ id: r.id, rowOrder: (i + 1) * 1000 }));
    const orderMap = new Map(updates.map(u => [u.id, u.rowOrder]));

    // Optimistic update of row order in parent state
    onRowsChange(prev => prev.map(r => orderMap.has(r.id) ? { ...r, rowOrder: orderMap.get(r.id)! } : r));

    // Handle group change if needed
    if (draggedGroupId !== targetGroupId) {
      const groupOps: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
      for (const g of groups) {
        if (groupDynCols.getCellVal(draggedId, g.id)?.textValue === '1') {
          groupOps.push({ rowId: draggedId, colId: g.id, value: {} });
        }
      }
      if (targetGroupId !== '__none__') {
        groupOps.push({ rowId: draggedId, colId: targetGroupId, value: { textValue: '1' } });
      }
      if (groupOps.length > 0) groupDynCols.batchSetCellVals(groupOps);
      toast.success('Participante movido al grupo');
      publishRecruitmentGroupsChanged({ projectCode: projectCode ?? '', changeType: 'membership' }).catch(() => {});
    }

    // Persist new order
    await reorderRecruitmentRows({ updates });
  };

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    dropTargetRef.current = null; cancelRaf(); hideDropLine();
    // Check if a row is being dragged — move it to this group at the end
    if (e.dataTransfer.types.includes('rowid')) {
      const rowId = e.dataTransfer.getData('rowId');
      if (rowId) {
        const draggedGroupId = getRowGroupId(rowId) ?? '__none__';
        if (draggedGroupId !== targetGroupId) {
          const groupOps: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
          for (const g of groups) {
            if (groupDynCols.getCellVal(rowId, g.id)?.textValue === '1') {
              groupOps.push({ rowId, colId: g.id, value: {} });
            }
          }
          if (targetGroupId !== '__none__') groupOps.push({ rowId, colId: targetGroupId, value: { textValue: '1' } });
          groupDynCols.batchSetCellVals(groupOps);
          toast.success('Participante movido al grupo');
          publishRecruitmentGroupsChanged({ projectCode: projectCode ?? '', changeType: 'membership' }).catch(() => {});
        }
        // Place at end of target group
        const targetGroupRows = grouped[targetGroupId] ?? [];
        const maxOrder = targetGroupRows.length > 0
          ? Math.max(...targetGroupRows.map(r => r.rowOrder ?? 0)) + 1000
          : 1000;
        onRowsChange(prev => prev.map(r => r.id === rowId ? { ...r, rowOrder: maxOrder } : r));
        await reorderRecruitmentRows({ updates: [{ id: rowId, rowOrder: maxOrder }] });
      }
      setDragRowId(null);
      setDropRowGroupId(null);
      dropRowGroupRef.current = null;
      return;
    }
    // Group reorder
    if (!dragGroupId || dragGroupId === targetGroupId || targetGroupId === '__none__') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'left' : 'right';
    await groupDynCols.reorderColumns(dragGroupId, targetGroupId, side);
    setDragGroupId(null);
    setDropTargetId(null);
  };

  // ── Delegated drag handlers on table container — zero enter/leave flicker ────
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const containerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    dragClientYRef.current = e.clientY;
    if (rafIdRef.current !== null) return; // already a frame scheduled

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = tableContainerRef.current;
      const dropLine  = dropLineRef.current;
      const draggedId = dragRowIdRef.current;
      if (!container || !dropLine || !draggedId) return;

      const clientY       = dragClientYRef.current;
      const containerRect = container.getBoundingClientRect();

      // Live rects from all data rows — excludes the dragged row
      const candidates = Array.from(
        container.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]')
      ).filter(tr => tr.getAttribute('data-row-id') !== draggedId);

      if (candidates.length === 0) { hideDropLine(); return; }

      // Clear group highlight now that we're computing a row-level insertion
      if (dropRowGroupRef.current) { dropRowGroupRef.current = null; setDropRowGroupId(null); }

      // Find insertion point by comparing clientY to each row's midpoint
      let targetId = candidates[candidates.length - 1].getAttribute('data-row-id')!;
      let position: 'before' | 'after' = 'after';
      let lineY    = candidates[candidates.length - 1].getBoundingClientRect().bottom;

      for (const tr of candidates) {
        const rect = tr.getBoundingClientRect();
        const mid  = rect.top + rect.height / 2;
        if (clientY < mid) {
          targetId = tr.getAttribute('data-row-id')!;
          position = 'before';
          lineY    = rect.top;
          break;
        }
      }

      dropTargetRef.current = { rowId: targetId, position };

      // Viewport Y → container-local Y (accounts for scroll)
      const localY = lineY - containerRect.top + container.scrollTop;
      dropLine.style.transform = `translateY(${localY - 1.5}px)`;
      dropLine.style.opacity   = '1';
    });
  };

  const containerDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    const srcRowId = e.dataTransfer.getData('rowId');
    const cur = dropTargetRef.current;
    dropTargetRef.current = null;
    cancelRaf();
    hideDropLine();
    dropRowGroupRef.current = null;
    dragRowIdRef.current = null;
    if (!srcRowId || !cur) { setDragRowId(null); setDropRowGroupId(null); return; }
    const targetRow = rows.find(r => r.id === cur.rowId);
    if (!targetRow || srcRowId === targetRow.id) { setDragRowId(null); setDropRowGroupId(null); return; }
    handleRowOnRowDrop(srcRowId, targetRow, cur.position);
    setDragRowId(null);
    setDropRowGroupId(null);
  };

  const containerDragLeave = (e: React.DragEvent) => {
    const container = tableContainerRef.current;
    if (container && !container.contains(e.relatedTarget as Node)) {
      dropTargetRef.current = null;
      cancelRaf();
      hideDropLine();
    }
  };

  // Shared border style for data cells
  const cellBorder = '1px solid hsl(var(--border) / 0.3)';

  const renderRow = (row: Row) => {
    const rowGroupId = getRowGroupId(row.id);
    const rowGroupColorId = rowGroupId ? groups.find(g => g.id === rowGroupId)?.columnType : undefined;
    const rowColor = rowGroupId ? getGroupColor(rowGroupColorId) : undefined;
    // ── Duplicate badge from batch endpoint (single source of truth) ─────
    const badge = badgeMap[row.id];

    return (
      <React.Fragment key={row.id}>
        {/* Main row — native <tr> */}
        <tr
          data-row-id={row.id}
          className={`group${dragRowId === row.id ? ' opacity-25' : ''}${selectedIds.has(row.id) ? ' bg-primary/5' : ''}`}
        >
          {/* Checkbox — sticky left:0 */}
          <td
            className={`h-9 pl-1 group-hover:bg-muted ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
            style={{
              position: 'sticky', left: 0, zIndex: 10,
              borderBottom: cellBorder,
              borderLeft: rowColor ? `3px solid ${rowColor}` : '3px solid transparent',
            }}
          >
            <div className="flex items-center gap-0.5 h-full">
              {/* Row drag handle */}
              <div
                draggable
                onDragStart={e => {
                  e.stopPropagation();
                  e.dataTransfer.setData('rowId', row.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragRowId(row.id);
                  dragRowIdRef.current = row.id;
                }}
                onDragEnd={() => { dragRowIdRef.current = null; cancelRaf(); hideDropLine(); setDragRowId(null); setDropRowGroupId(null); dropTargetRef.current = null; dropRowGroupRef.current = null; }}
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-all flex-shrink-0 py-1"
              >
                <GripVertical className="w-3 h-3" />
              </div>
              <Checkbox checked={selectedIds.has(row.id)} onCheckedChange={() => toggleSelect(row.id)} className="h-3.5 w-3.5" />
            </div>
          </td>

          {/* Name — sticky left:32 */}
          <td
            className={`px-2 py-0 h-9 overflow-hidden group-hover:bg-muted border-r border-border/40 ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
            style={{ position: 'sticky', left: 35, zIndex: 10, borderBottom: cellBorder }}
          >
            <div className="flex items-center gap-1.5 w-full h-full">
              {editingName === row.id ? (
                <InlineInput
                  value={row.participantName ?? row.rowName ?? ''}
                  className="font-medium text-foreground flex-1"
                  onSave={val => { if (val.trim()) onSaveName(row.id, val.trim()); setEditingName(null); }}
                  onCancel={() => setEditingName(null)}
                />
              ) : (
                <span className="text-sm font-medium cursor-pointer hover:text-primary flex-1 truncate flex items-center gap-1 min-w-0"
                  onClick={() => setEditingName(row.id)}>
                  <span className="truncate" title={row.participantName || row.rowName || ''}>{row.participantName || row.rowName}</span>
                </span>
              )}
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onEdit(row)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"><Pencil className="w-3 h-3" /></button>
                <button onClick={() => onDelete(row.id)} className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-destructive/10"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          </td>

          {/* Duplicate/eligibility badge columns — pinned next to name, single source of truth: badgeMap */}
          {!hiddenColumns.has('_dupBoard') && (
            <td
              className={`px-1 py-0 h-9 overflow-hidden text-center group-hover:bg-muted ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
              style={{ position: 'sticky', left: dupBoardLeft, zIndex: 10, borderBottom: cellBorder, borderLeft: '1px solid hsl(var(--border) / 0.4)' }}
            >
              {badge && badge.sameBoardCount > 1 && (
                <button
                  title={`Aparece ×${badge.sameBoardCount} veces en este tablero`}
                  onClick={() => onDuplicateClick(row)}
                  className="hover:opacity-70 transition-opacity inline-flex items-center gap-0.5">
                  <Layers className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-[10px] font-bold leading-none text-orange-600">×{badge.sameBoardCount}</span>
                </button>
              )}
            </td>
          )}
          {!hiddenColumns.has('_dupHistory') && (
            <td
              className={`px-1 py-0 h-9 overflow-hidden text-center group-hover:bg-muted ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
              style={{ position: 'sticky', left: dupHistoryLeft, zIndex: 10, borderBottom: cellBorder, borderLeft: '1px solid hsl(var(--border) / 0.4)' }}
            >
              {badge?.signals.includes('old') ? (
                <button
                  title="Participó en estudios anteriores (hace más de 6 meses)"
                  onClick={() => onDuplicateClick(row)}
                  className="hover:opacity-70 transition-opacity inline-flex">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              ) : badge?.signals.includes('registered_only') && (
                <button
                  title="Registrado en otro estudio (sin participar)"
                  onClick={() => onDuplicateClick(row)}
                  className="hover:opacity-70 transition-opacity inline-flex">
                  <Copy className="w-3.5 h-3.5 text-blue-500" />
                </button>
              )}
            </td>
          )}
          {!hiddenColumns.has('_dupRisk') && (
            <td
              className={`px-1 py-0 h-9 overflow-hidden text-center group-hover:bg-muted ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
              style={{ position: 'sticky', left: dupRiskLeft, zIndex: 10, borderBottom: cellBorder, borderLeft: '1px solid hsl(var(--border) / 0.4)' }}
            >
              {badge?.hasHighRisk && (
                <button
                  title={badge.signals.includes('same_client') ? '⚠️ Mismo cliente — restricción siempre aplica' : '⚠️ Participó recientemente (< 6 meses)'}
                  onClick={() => onDuplicateClick(row)}
                  className="hover:opacity-70 transition-opacity inline-flex">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                </button>
              )}
            </td>
          )}

          {/* Inline editable fields: email / phone / idNumber */}
          {(['email', 'phone', 'idNumber'] as const).filter(f => !hiddenColumns.has(f)).map((field) => {
            const val = (row[field] ?? '') as string;
            const isEditing = editingField?.id === row.id && editingField?.field === field;
            return (
              <td key={field}
                  className={`px-2 py-0 h-9 overflow-hidden text-xs text-muted-foreground border-l border-border/30 cursor-text ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`}
                  style={{ borderBottom: cellBorder }}
                  onClick={() => !isEditing && setEditingField({ id: row.id, field })}
              >
                <div className="flex items-center h-full">
                  {isEditing ? (
                    <InlineInput value={val} className="text-xs text-foreground"
                      suggestions={colUniqueValues(field)}
                      onSave={v => {
                        onSaveField(row.id, field, v);
                        setEditingField(null);
                        if (v.trim() && selectedIds.has(row.id)) showBulkConfirm(v, () => [...selectedIds].filter(id => id !== row.id).forEach(id => onSaveField(id, field, v)));
                      }}
                      onCancel={() => setEditingField(null)} />
                  ) : (
                    <span className="truncate block max-w-full" title={val}>{val}</span>
                  )}
                </div>
              </td>
            );
          })}

          {/* Status */}
          {!hiddenColumns.has('status') && (
            <td className={`px-2 py-0 h-9 overflow-hidden border-l border-border/30 ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`} style={{ borderBottom: cellBorder }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center h-full w-full text-left focus:outline-none">
                    <StatusBadge status={row.status} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  {statuses.map(s => (
                    <DropdownMenuItem key={s} onClick={() => {
                      onUpdateStatus(row.id, s);
                      if (selectedIds.has(row.id)) showBulkConfirm(s, () => [...selectedIds].filter(id => id !== row.id).forEach(id => onUpdateStatus(id, s)));
                    }} className="gap-2 text-xs">
                      <StatusBadge status={s} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          )}

          {/* NDA */}
          {!hiddenColumns.has('nda') && (
            <td className={`px-2 py-0 h-9 overflow-hidden border-l border-border/30 ${selectedIds.has(row.id) ? 'bg-primary/5' : 'bg-card'}`} style={{ borderBottom: cellBorder }}>
              <div className="flex items-center h-full">
                {row.ndaSent
                  ? <Badge variant="outline" className="text-xs border-green-300 text-green-700">NDA ✓</Badge>
                  : <button onClick={() => onSendNDA(row.id)} className="text-muted-foreground hover:text-primary text-xs px-1.5 py-0.5 rounded hover:bg-muted flex items-center gap-1 transition-colors">
                      <FileText className="w-3 h-3" /> NDA
                    </button>
                }
              </div>
            </td>
          )}

          {/* Dynamic columns — renders <td> elements (no asDiv) */}
          <DynamicColumnCells rowId={row.id} dynCols={dynCols} hiddenColumns={hiddenColumns} recentColors={recentColors}
            colUniqueValues={colUniqueValues}
            selectedIds={selectedIds}
            visibleColIds={visibleDynColIds}
            onBulkSave={getBulkSaveHandler(row.id)} />
        </tr>
      </React.Fragment>
    );
  };

  const groupOrder = useMemo(
    () => [{ id: '__none__', columnName: 'Sin grupo', columnType: undefined as string | undefined }, ...groups],
    [groups]
  );

  return (
    <>
      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl shadow-lg animate-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-medium">{selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1 ml-auto">
            {(
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"><FolderPlus className="w-3 h-3" /> Mover a...</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => {
                      const ops: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
                      for (const id of selectedIds) {
                        for (const grp of groups) {
                          if (groupDynCols.getCellVal(id, grp.id)?.textValue === '1') ops.push({ rowId: id, colId: grp.id, value: {} });
                        }
                      }
                      groupDynCols.batchSetCellVals(ops);
                      setSelectedIds(new Set());
                      toast.success('Movido a Sin grupo');
                      publishRecruitmentGroupsChanged({ projectCode: projectCode ?? '', changeType: 'membership' }).catch(() => {});
                    }} className="text-xs gap-2">
                    <div className="w-2.5 h-2.5 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" />Sin grupo
                  </DropdownMenuItem>
                  <div className="my-1 border-t border-border/30" />
                  {groups.map(g => (
                    <DropdownMenuItem key={g.id} onClick={() => {
                        const ops: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
                        for (const id of selectedIds) {
                          for (const grp of groups) {
                            if (groupDynCols.getCellVal(id, grp.id)?.textValue === '1') ops.push({ rowId: id, colId: grp.id, value: {} });
                          }
                          ops.push({ rowId: id, colId: g.id, value: { textValue: '1' } });
                        }
                        groupDynCols.batchSetCellVals(ops);
                        // Place each moved row at the bottom of the target group, sequentially
                        const targetGroupRows = grouped[g.id] ?? [];
                        const baseOrder = targetGroupRows.length > 0
                          ? Math.max(...targetGroupRows.map(r => r.rowOrder ?? 0))
                          : 0;
                        const movedIds = [...selectedIds];
                        const orderUpdates = movedIds.map((id, i) => ({ id, rowOrder: baseOrder + (i + 1) * 1000 }));
                        const orderMap = new Map(orderUpdates.map(u => [u.id, u.rowOrder]));
                        onRowsChange(prev => prev.map(r => orderMap.has(r.id) ? { ...r, rowOrder: orderMap.get(r.id)! } : r));
                        reorderRecruitmentRows({ updates: orderUpdates }).catch(() => {});
                        setSelectedIds(new Set());
                        toast.success(`Movido a ${g.columnName}`);
                        publishRecruitmentGroupsChanged({ projectCode: projectCode ?? '', changeType: 'membership' }).catch(() => {});
                      }} className="text-xs gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getGroupColor(g.columnType) }} />
                      <span className="truncate">{g.columnName}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"
              disabled={duplicating}
              onClick={async () => {
                setDuplicating(true);
                try {
                  await duplicateRows({ ids: [...selectedIds], tableType: 'recruitment' });
                  toast.success(`${selectedIds.size} fila${selectedIds.size !== 1 ? 's' : ''} duplicada${selectedIds.size !== 1 ? 's' : ''}`);
                  setSelectedIds(new Set());
                  onRefresh?.();
                } catch { toast.error('Error al duplicar'); }
                setDuplicating(false);
              }}
            >
              {duplicating ? <div className="w-3 h-3 border border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <ClipboardCopy className="w-3 h-3" />}
              Duplicar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-destructive/80 text-destructive-foreground hover:bg-destructive border-0" onClick={() => { onBulkDelete([...selectedIds]); setSelectedIds(new Set()); }}><Trash2 className="w-3 h-3" /> Eliminar</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setSelectedIds(new Set())}>Cancelar</Button>
          </div>
        </div>
      )}
      {/* ── Single-table layout: correct sticky column & group headers ── */}
      <div
        ref={tableContainerRef}
        className="bg-card border rounded-lg overflow-auto flex-1 min-h-0"
        style={{ position: 'relative', overscrollBehavior: 'contain' }}
        onDragOver={containerDragOver}
        onDrop={containerDrop}
        onDragLeave={containerDragLeave}
      >
        {/* Drop line overlay — GPU composited, zero layout impact on the table */}
        <div
          ref={dropLineRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 3,
            pointerEvents: 'none',
            opacity: 0,
            zIndex: 50,
            background: 'hsl(var(--primary))',
            borderRadius: 9999,
            boxShadow: '0 0 10px hsl(var(--primary) / 0.6)',
            willChange: 'transform, opacity',
            transform: 'translateY(0)',
            transition: 'opacity 0.08s',
          }}
        >
          <div style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'hsl(var(--primary))', border: '2px solid hsl(var(--card))', zIndex: 1 }} />
          <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'hsl(var(--primary))', border: '2px solid hsl(var(--card))', zIndex: 1 }} />
        </div>
        <table style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, width: 32 + nameCol.width + (!hiddenColumns.has('_dupBoard') ? dupBoardColW.width : 0) + (!hiddenColumns.has('_dupHistory') ? dupHistoryColW.width : 0) + (!hiddenColumns.has('_dupRisk') ? dupRiskColW.width : 0) + (!hiddenColumns.has('email') ? emailColW.width : 0) + (!hiddenColumns.has('phone') ? phoneColW.width : 0) + (!hiddenColumns.has('idNumber') ? idNumColW.width : 0) + (!hiddenColumns.has('status') ? statusColW.width : 0) + (!hiddenColumns.has('nda') ? ndaColW.width : 0) + visibleDynCols.reduce((sum, c) => sum + dynCols.getColWidth(c.id), 0) + 60, minWidth: '100%' }}><colgroup>
            <col style={{ width: 32 }} />
            <col ref={nameCol.colRef as React.RefObject<HTMLTableColElement>} style={{ width: nameCol.width }} />
            {!hiddenColumns.has('_dupBoard')   && <col ref={dupBoardColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: dupBoardColW.width }} />}
            {!hiddenColumns.has('_dupHistory') && <col ref={dupHistoryColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: dupHistoryColW.width }} />}
            {!hiddenColumns.has('_dupRisk')    && <col ref={dupRiskColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: dupRiskColW.width }} />}
            {!hiddenColumns.has('email')    && <col ref={emailColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: emailColW.width }} />}
            {!hiddenColumns.has('phone')    && <col ref={phoneColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: phoneColW.width }} />}
            {!hiddenColumns.has('idNumber') && <col ref={idNumColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: idNumColW.width }} />}
            {!hiddenColumns.has('status')   && <col ref={statusColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: statusColW.width }} />}
            {!hiddenColumns.has('nda')      && <col ref={ndaColW.colRef as React.RefObject<HTMLTableColElement>} style={{ width: ndaColW.width }} />}
            {visibleDynCols.map(c => { const w = dynCols.getColWidth(c.id); return <col key={c.id} data-col-id={c.id} style={{ width: w, minWidth: w, maxWidth: w }} />; })}
            <col />
          </colgroup><thead>
            <tr style={{ height: 33 }}>
              {/* Collapse/expand all — doubly sticky (X + Y) */}
              <th className="bg-muted border-b border-border/50"
                  style={{ position: 'sticky', top: 0, left: 0, zIndex: 40 }}>
                <button
                  onClick={() => expandedGroups.size > 0 ? setExpandedGroups(new Set()) : setExpandedGroups(new Set(groupOrder.map(g => g.id)))}
                  className="w-full h-full flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
                  title={expandedGroups.size > 0 ? 'Colapsar todos los grupos' : 'Expandir todos los grupos'}
                >
                  {expandedGroups.size > 0 ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
                </button>
              </th>

              {/* Name — doubly sticky */}
              <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40 relative group/nth"
                  style={{ position: 'sticky', top: 0, left: 35, zIndex: 40 }}>
                <div className="flex items-center">
                  <button onClick={() => toggleSort('participantName')} className="flex items-center gap-1 hover:bg-muted-foreground/10 transition-colors rounded px-1 -mx-1">
                    Participante
                    {sortColumn === 'participantName' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover/nth:opacity-100" />}
                  </button>
                  <ColumnFilterPopover allValues={colUniqueValues('participantName')} activeValues={columnFilters['participantName'] ?? new Set()} onApply={v => setColFilter('participantName', v)} />
                </div>
                <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/nth:opacity-100 transition-opacity z-10"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); nameCol.startResize(e.clientX); }} />
              </th>

              {/* Duplicate/eligibility badge columns — doubly sticky, pinned next to name. Icon-only header (title = tooltip) since these columns are narrow. */}
              {([
                { key: '_dupBoard'   as const, label: 'Este filtro',       icon: Layers,        colW: dupBoardColW,   left: dupBoardLeft },
                { key: '_dupHistory' as const, label: 'Otros formularios', icon: Clock,         colW: dupHistoryColW, left: dupHistoryLeft },
                { key: '_dupRisk'    as const, label: 'Elegibilidad',      icon: AlertTriangle, colW: dupRiskColW,    left: dupRiskLeft },
              ]).filter(col => !hiddenColumns.has(col.key)).map(col => (
                <th key={col.key}
                    className="text-center px-1 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-l border-border/40 relative group/th select-none"
                    style={{ position: 'sticky', top: 0, left: col.left, zIndex: 40 }}>
                  <div className="flex items-center justify-center gap-1 group/hdr" title={col.label}>
                    <button onClick={() => toggleSort(col.key)} className="flex items-center gap-0.5 hover:bg-muted-foreground/10 transition-colors rounded px-1">
                      <col.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {sortColumn === col.key && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 text-primary flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />)}
                    </button>
                    <ColumnFilterPopover allValues={colUniqueValues(col.key)} activeValues={columnFilters[col.key] ?? new Set()} onApply={v => setColFilter(col.key, v)} />
                  </div>
                  <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); col.colW.startResize(e.clientX); }} />
                </th>
              ))}

              {/* Fixed columns */}
              {([
                { key: 'email'    as const, label: 'Email',    colW: emailColW  },
                { key: 'phone'    as const, label: 'Teléfono', colW: phoneColW  },
                { key: 'idNumber' as const, label: 'ID / Doc', colW: idNumColW  },
                { key: 'status'   as const, label: 'Estado',   colW: statusColW },
              ]).filter(col => !hiddenColumns.has(col.key)).map(col => (
                <th key={col.key}
                    className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-l border-border/50 relative group/th select-none"
                    style={{ position: 'sticky', top: 0, zIndex: 30 }}>
                  <div className="flex items-center gap-1.5 group/hdr">
                    <GripVertical className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover/hdr:opacity-100 flex-shrink-0 cursor-grab transition-opacity" />
                    <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1 hover:bg-muted-foreground/10 transition-colors rounded px-1 -mx-1">
                      <span className="truncate">{col.label}</span>
                      {sortColumn === col.key ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 text-primary flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 flex-shrink-0 opacity-0 group-hover/hdr:opacity-100" />}
                    </button>
                    <ColumnFilterPopover allValues={colUniqueValues(col.key)} activeValues={columnFilters[col.key] ?? new Set()} onApply={v => setColFilter(col.key, v)} />
                  </div>
                  <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); col.colW.startResize(e.clientX); }} />
                </th>
              ))}

              {/* NDA */}
              {!hiddenColumns.has('nda') && (
                <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-l border-border/50 relative group/th select-none"
                    style={{ position: 'sticky', top: 0, zIndex: 30 }}>
                  <div className="flex items-center gap-1.5 group/hdr">
                    <GripVertical className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover/hdr:opacity-100 flex-shrink-0 cursor-grab transition-opacity" />
                    <span>NDA</span>
                  </div>
                  <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); ndaColW.startResize(e.clientX); }} />
                </th>
              )}

              {/* Dynamic column headers — sticky via prop */}
              <DynamicColumnHeaders dynCols={dynCols} sticky columnFilters={columnFilters} setColFilter={setColFilter} colUniqueValues={colUniqueValues} hiddenColumns={hiddenColumns} sortColumn={sortColumn} sortDirection={sortDirection} onToggleSort={toggleSort} visibleColIds={visibleDynColIds} />
            </tr>
          </thead>

          <tbody>
            {groupOrder.map((g, idx) => {
              const rowsInGroup = grouped[g.id] ?? [];
              const isExpanded  = expandedGroups.has(g.id);
              const isNone      = g.id === '__none__';

              // Group filter: hide groups not in the active filter set
              if (activeGroupFilter !== null) {
                if (isNone) {
                  if (!activeGroupFilter.has('Sin grupo')) return null;
                } else {
                  if (!activeGroupFilter.has(g.columnName ?? '')) return null;
                }
              }

              return (
                <React.Fragment key={g.id}>
                  {/* Spacer row between groups */}
                  {idx > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={totalCols} style={{ height: 12, padding: 0, border: 'none', background: 'transparent' }} />
                    </tr>
                  )}

                  {/* Group header row — sticky <td colspan> at top:33px */}
                  <GroupSectionHeader
                    showPublicName={true}
                    groupId={g.id}
                    name={g.columnName ?? 'Sin grupo'}
                    colorId={g.columnType}
                    optionsJson={isNone ? undefined : groupDynCols.columns.find(c => c.id === g.id)?.optionsJson}
                    itemCount={rowsInGroup.length}
                    isExpanded={isExpanded}
                    isNone={isNone}
                    onToggle={() => toggleGroup(g.id)}
                    groupDynCols={groupDynCols}
                    colSpan={totalCols}
                    itemIds={rowsInGroup.map(r => r.id)}
                    selectedIds={selectedIds}
                    onToggleSelectAll={(ids, select) => setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => select ? n.add(id) : n.delete(id)); return n; })}
                    onDragStart={id => setDragGroupId(id)}
                    onDragOver={(e, id) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('rowid')) {
        cancelRaf();
        hideDropLine();
        if (dropTargetRef.current) { dropTargetRef.current = null; }
        if (dropRowGroupRef.current !== id) { dropRowGroupRef.current = id; setDropRowGroupId(id); }
      } else {
        setDropTargetId(id);
      }
    }}
                    onDragEnd={() => { setDragGroupId(null); setDropTargetId(null); }}
                    onDrop={handleGroupDrop}
                    isDragOver={(dropTargetId === g.id && dragGroupId !== g.id) || dropRowGroupId === g.id}
                    onDuplicateGroup={onDuplicateGroup && !isNone ? () => onDuplicateGroup(g.id) : undefined}
                    onGroupStructureChanged={!isNone ? onGroupStructureChanged : undefined}
                    linkedEventInfo={(() => {
                      if (isNone) return undefined;
                      try {
                        const opts = JSON.parse(groupDynCols.columns.find(c => c.id === g.id)?.optionsJson ?? '{}');
                        const evId = opts?.linkedCalEvent?.eventId;
                        return evId ? linkedEventsMap?.[evId] : undefined;
                      } catch { return undefined; }
                    })()}
                    projectCode={projectCode}
                    onCreateEventForGroup={!isNone && onCreateEventForGroup ? async () => { await onCreateEventForGroup(g.id); } : undefined}
                    onLinkEvent={!isNone ? async (calBoardId, eventId) => {
                      await linkGroupToEvent({ groupColumnId: g.id, recruitmentBoardId: recruitmentBoardId ?? '', calendarBoardId: calBoardId, eventId });
                      try {
                        const existing = groupDynCols.columns.find(c => c.id === g.id)?.optionsJson ?? '{}';
                        const opts = JSON.parse(existing) as Record<string, unknown>;
                        opts.linkedCalEvent = { calBoardId, eventId };
                        await groupDynCols.updateColumn(g.id, { optionsJson: JSON.stringify(opts) });
                      } catch { /* skip */ }
                      onLinkedEventsRefresh?.();
                    } : undefined}
                    onUnlinkEvent={!isNone ? async () => {
                      try {
                        const existing = groupDynCols.columns.find(c => c.id === g.id)?.optionsJson ?? '{}';
                        const opts = JSON.parse(existing) as Record<string, unknown>;
                        const link = opts?.linkedCalEvent as { calBoardId?: string; eventId?: string } | undefined;
                        if (link?.calBoardId && link?.eventId) {
                          await linkGroupToEvent({ groupColumnId: g.id, recruitmentBoardId: recruitmentBoardId ?? '', calendarBoardId: link.calBoardId, eventId: link.eventId, unlink: true });
                        }
                        delete opts.linkedCalEvent;
                        await groupDynCols.updateColumn(g.id, { optionsJson: JSON.stringify(opts) });
                      } catch { /* skip */ }
                      onLinkedEventsRefresh?.();
                    } : undefined}
                  />

                  {isExpanded && (
                    <>
                      {rowsInGroup.length === 0 && (
                        <tr>
                          <td colSpan={totalCols} className="px-10 py-3 text-xs text-muted-foreground/50 italic"
                              style={{ borderBottom: '1px solid hsl(var(--border) / 0.2)' }}>
                            {isNone ? 'Todos los participantes están en un grupo.' : 'Grupo vacío — agrega participantes aquí.'}
                          </td>
                        </tr>
                      )}
                      {(() => {
                        const sortedGroupRows = sortColumn
                          ? rowsInGroup
                          : [...rowsInGroup].sort((a, b) => {
                              if (isNone) {
                                // Sin grupo: respeta rowOrder si fue asignado (drag & drop),
                                // de lo contrario ordena por id de forma ascendente (UUID v7 = cronológico)
                                const aOrder = a.rowOrder ?? Number.MAX_SAFE_INTEGER;
                                const bOrder = b.rowOrder ?? Number.MAX_SAFE_INTEGER;
                                if (aOrder !== bOrder) return aOrder - bOrder;
                                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
                              }
                              // Grupos con nombre: orden de drag & drop (rowOrder)
                              return (a.rowOrder ?? 0) - (b.rowOrder ?? 0);
                            });
                        // ── Performance Mode: virtual scroller for Sin grupo ──
                        if (isNone) noneRowCountRef.current = sortedGroupRows.length;
                        if (isNone && sortedGroupRows.length > VIRT_THRESHOLD) {
                          const totalRows   = sortedGroupRows.length;
                          const virtStart   = noneVirtRange.start;
                          const virtEnd     = Math.min(totalRows, noneVirtRange.end);
                          const topSpacerH  = virtStart * ROW_HEIGHT;
                          const botSpacerH  = Math.max(0, totalRows - virtEnd) * ROW_HEIGHT;
                          return (
                            <>
                              {/* Sentinel: marks the start of Sin grupo rows so we can compute scroll offset */}
                              <tr ref={noneGroupSentinelRef} aria-hidden="true" style={{ height: 0, visibility: 'hidden', border: 'none' }}>
                                <td colSpan={totalCols} style={{ padding: 0, border: 'none', height: 0 }} />
                              </tr>
                              {topSpacerH > 0 && (
                                <tr aria-hidden="true">
                                  <td colSpan={totalCols} style={{ height: topSpacerH, padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                              )}
                              {sortedGroupRows.slice(virtStart, virtEnd).map(r => renderRow(r))}
                              {botSpacerH > 0 && (
                                <tr aria-hidden="true">
                                  <td colSpan={totalCols} style={{ height: botSpacerH, padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                              )}
                            </>
                          );
                        }
                        // Normal rendering for named groups (typically small)
                        return (
                          <>
                            {sortedGroupRows.map(r => renderRow(r))}
                          </>
                        );
                      })()}

                      {/* Quick-add row */}
                      <tr>
                        <td colSpan={totalCols} className="px-10 py-2"
                            style={{ borderBottom: '1px dashed hsl(var(--border) / 0.3)' }}>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Plus className="w-3 h-3 opacity-40 flex-shrink-0" />
                            <input
                              value={newRowNames[g.id] ?? ''}
                              onChange={e => setNewRowNames(p => ({ ...p, [g.id]: e.target.value }))}
                              onKeyDown={e => {
                                const v = newRowNames[g.id] ?? '';
                                if (e.key === 'Enter' && v.trim()) { onQuickCreate(v.trim(), isNone ? undefined : g.id); setNewRowNames(p => ({ ...p, [g.id]: '' })); }
                                if (e.key === 'Escape') setNewRowNames(p => ({ ...p, [g.id]: '' }));
                              }}
                              placeholder="Nuevo participante...  (Enter para crear)"
                              className="flex-1 bg-transparent outline-none border-0 text-sm placeholder:text-muted-foreground/40 focus:text-foreground transition-colors"
                            />
                          </div>
                        </td>
                      </tr>
                    </>
                  )}
                </React.Fragment>
              );
            })}

            {/* New group button */}
            <tr>
              <td colSpan={totalCols} className="px-3 py-2"
                  style={{ borderTop: '1px dashed hsl(var(--border) / 0.3)' }}>
                <button onClick={onCreateGroup} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-2 py-1.5 rounded-md transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" /> Nuevo grupo
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
});

// ── Duplicate History Modal ───────────────────────────────────────────────────
type HistoryResult = SearchParticipantHistoryOutputType['results'][0];
type HistoryEntry  = HistoryResult['history'][0];

function MatchedByBadges({ matchedBy }: { matchedBy: string[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Identificado por:</span>
      {matchedBy.includes('email') && (
        <span className="inline-flex items-center gap-0.5 text-[11px] bg-sky-500/10 text-sky-600 border border-sky-400/40 rounded px-1.5 py-0.5 font-medium">
          <Mail className="w-2.5 h-2.5" /> Email
        </span>
      )}
      {matchedBy.includes('name') && (
        <span className="inline-flex items-center gap-0.5 text-[11px] bg-violet-500/10 text-violet-600 border border-violet-400/40 rounded px-1.5 py-0.5 font-medium">
          <User className="w-2.5 h-2.5" /> Nombre
        </span>
      )}
      {matchedBy.includes('phone') && (
        <span className="inline-flex items-center gap-0.5 text-[11px] bg-emerald-500/10 text-emerald-600 border border-emerald-400/40 rounded px-1.5 py-0.5 font-medium">
          <Phone className="w-2.5 h-2.5" /> Teléfono
        </span>
      )}
    </div>
  );
}

function ParticipationBadge({ h }: { h: HistoryEntry }) {
  const wl = (h as any).warningLevel as string | null | undefined;
  const sc = (h as any).sameClient as boolean | undefined;
  const ir = (h as any).isRecent as boolean | undefined;
  const cn = (h as any).clientName as string | undefined;

  if (wl === 'same_board') return null;
  if (wl === 'same_client') {
    return (
      <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-0.5 font-medium">
        ⚠️ Mismo cliente{cn ? ` (${cn})` : ''}
      </Badge>
    );
  }
  if (wl === 'recent') {
    return (
      <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-0.5 font-medium">
        ⚠️ Activo / reciente
      </Badge>
    );
  }
  if (wl === 'old') {
    return (
      <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-blue-600 border-blue-400/40 bg-blue-500/5">
        Participó hace +6m
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-blue-600 border-blue-400/40 bg-blue-500/5">
      Solo registrado
    </Badge>
  );
}

function HistoryEntryCard({ h, isCurrentBoard }: { h: HistoryEntry; isCurrentBoard?: boolean }) {
  const isCurrentRow = (h as any).isCurrentRow as boolean | undefined;
  const wl = (h as any).warningLevel as string | null | undefined;
  const borderCls = wl === 'same_client' || wl === 'recent'
    ? 'border-destructive/50 bg-destructive/5'
    : isCurrentRow
    ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
    : isCurrentBoard
    ? 'border-primary/25 bg-primary/3'
    : h.sameProject
    ? 'border-orange-400/40 bg-orange-500/5'
    : wl === 'old' || !wl
    ? 'border-blue-400/40 bg-blue-500/5'
    : 'border-border bg-muted/30';

  return (
    <div className={`border rounded-lg px-3 py-2.5 ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Project + board + current-row badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono font-bold text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {h.projectCode}
            </span>
            {h.boardName && (
              <span className="text-xs font-medium text-foreground/80 flex items-center gap-0.5">
                <Layers className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                {h.boardName}
              </span>
            )}
            {isCurrentRow && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground tracking-wide">
                ESTE REGISTRO
              </span>
            )}
          </div>

          {/* Group — show prominently for internal duplicates */}
          {h.group ? (
            <div className="mt-1 text-[11px] flex items-center gap-1">
              <span className="font-medium text-muted-foreground">Grupo:</span>
              <span className="font-semibold text-foreground/80">{h.group}</span>
            </div>
          ) : isCurrentBoard ? (
            <div className="mt-1 text-[11px] text-muted-foreground italic">Sin grupo asignado</div>
          ) : null}

          {/* Badges row */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {h.status && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">{h.status}</Badge>
            )}
            <ParticipationBadge h={h} />
            {h.sourceForm && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 italic">
                <ExternalLink className="w-2.5 h-2.5" /> {h.sourceForm}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DuplicateHistoryModal({ row, onClose, currentClient }: { row: Row; onClose: () => void; currentClient?: string }) {
  const [results, setResults] = useState<HistoryResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchParticipantHistory({ seedRowId: row.id, projectCode: row.projectCode, boardName: row.boardName, rowId: row.id, currentClient })
      .then(d => { setResults(d.results); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Flatten all history entries across all results for analysis
  const allEntries = results.flatMap(r => r.history);
  const currentBoardEntries = allEntries.filter(h => h.sameBoard);
  const sameProjectOtherBoardEntries = allEntries.filter(h => h.sameProject && !h.sameBoard);
  const otherProjectEntries = allEntries.filter(h => !h.sameProject && !h.sameBoard);
  // Total = all cross-board entries + same-board entries (each row counts separately)
  const totalAppearances = currentBoardEntries.length + sameProjectOtherBoardEntries.length + otherProjectEntries.length;
  // Internal duplicates: same board has MORE than 1 entry
  const internalDuplicateCount = currentBoardEntries.length;
  // Use result-level badges — single source of truth from searchParticipantHistory
  const hasSameClient      = results[0]?.primaryBadge === 'same_client';
  const hasRecentParticip  = results[0]?.primaryBadge === 'recent';
  const hasOldParticip     = results[0]?.primaryBadge === 'old';
  const hasParticipated    = hasSameClient || hasRecentParticip || hasOldParticip;
  const totalProjects = new Set(allEntries.filter(h => !h.sameBoard).map(h => h.projectCode)).size;

  // Identity — use the first result that matches
  const primaryResult = results[0];

  // Summary banner config
  const bannerConfig = hasSameClient
    ? { bg: 'bg-destructive/10 border-destructive/30', icon: <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />, text: '⚠️ Mismo cliente — restricción siempre aplica', textCls: 'text-destructive font-semibold' }
    : hasRecentParticip
    ? { bg: 'bg-destructive/10 border-destructive/30', icon: <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />, text: '⚠️ Participó recientemente o está activo en otro proyecto (< 6 meses)', textCls: 'text-destructive font-semibold' }
    : hasOldParticip
    ? { bg: 'bg-blue-500/10 border-blue-400/30', icon: <Copy className="w-4 h-4 text-blue-600 flex-shrink-0" />, text: 'Participó en estudios anteriores (hace más de 6 meses)', textCls: 'text-blue-700 font-medium' }
    : otherProjectEntries.length > 0
    ? { bg: 'bg-blue-500/10 border-blue-400/30', icon: <Copy className="w-4 h-4 text-blue-600 flex-shrink-0" />, text: `Registrado en ${totalProjects} estudio${totalProjects !== 1 ? 's' : ''} (sin participar)`, textCls: 'text-blue-700 font-semibold' }
    : sameProjectOtherBoardEntries.length > 0
    ? { bg: 'bg-orange-500/10 border-orange-400/30', icon: <Layers className="w-4 h-4 text-orange-600 flex-shrink-0" />, text: 'Aparece en otro tablero de este proyecto', textCls: 'text-orange-700 font-semibold' }
    : internalDuplicateCount > 1
    ? { bg: 'bg-orange-500/10 border-orange-400/30', icon: <Layers className="w-4 h-4 text-orange-600 flex-shrink-0" />, text: `Aparece ${internalDuplicateCount} veces en este mismo tablero`, textCls: 'text-orange-700 font-semibold' }
    : { bg: 'bg-muted border-border', icon: <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />, text: 'Primera vez en este estudio', textCls: 'text-foreground font-semibold' };

  const titleCount = !loading && internalDuplicateCount > 1
    ? ` · ${internalDuplicateCount} en este tablero`
    : !loading && (otherProjectEntries.length + sameProjectOtherBoardEntries.length) > 0
    ? ` · ${otherProjectEntries.length + sameProjectOtherBoardEntries.length} otro${otherProjectEntries.length + sameProjectOtherBoardEntries.length !== 1 ? 's' : ''} estudio${otherProjectEntries.length + sameProjectOtherBoardEntries.length !== 1 ? 's' : ''}`
    : '';

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {hasSameClient || hasRecentParticip
              ? <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
              : hasOldParticip || otherProjectEntries.length > 0
              ? <Copy className="w-4 h-4 text-blue-500 flex-shrink-0" />
              : internalDuplicateCount > 1 || sameProjectOtherBoardEntries.length > 0
              ? <Layers className="w-4 h-4 text-orange-500 flex-shrink-0" />
              : <Clock className="w-4 h-4 text-primary flex-shrink-0" />
            }
            <span>Historial del participante{!loading && totalAppearances > 0 ? titleCount : ''}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Participant identity */}
        <div className="-mt-1 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{row.participantName || row.rowName}</span>
          {primaryResult?.email && <span className="text-xs text-muted-foreground">{primaryResult.email}</span>}
          {primaryResult?.phone && <span className="text-xs text-muted-foreground">{primaryResult.phone}</span>}
        </div>

        <ScrollArea className="max-h-[500px] pr-1">
          {loading ? (
            <div className="space-y-2 mt-1">
              {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
            </div>
          ) : results.length === 0 || totalAppearances === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500/60 mb-2" />
              <p className="text-sm font-semibold">Sin historial previo</p>
              <p className="text-xs text-muted-foreground mt-1">Este participante no aparece en otros estudios.</p>
            </div>
          ) : (
            <div className="space-y-3 mt-1 pb-1">

              {/* ── Summary banner ── */}
              <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${bannerConfig.bg}`}>
                {bannerConfig.icon}
                <div className="min-w-0">
                  <p className={`text-sm ${bannerConfig.textCls}`}>{bannerConfig.text}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalAppearances} aparición{totalAppearances !== 1 ? 'es' : ''} en total
                    {results.some(r => r.matchedBy.length > 0) && (
                      <span className="ml-1">· <MatchedByBadgesInline matchedBy={[...new Set(results.flatMap(r => r.matchedBy))]} /></span>
                    )}
                  </p>
                </div>
              </div>

              {/* ── Section: Este tablero (current board) ── */}
              {currentBoardEntries.length > 0 && (
                <HistorySection
                  label={internalDuplicateCount > 1
                    ? `Este tablero · ${internalDuplicateCount} filas duplicadas`
                    : 'Este tablero'}
                  dotColor="bg-primary"
                  entries={currentBoardEntries}
                  isCurrentBoard
                />
              )}

              {/* ── Section: Mismo proyecto, otro tablero ── */}
              {sameProjectOtherBoardEntries.length > 0 && (
                <HistorySection
                  label="Otro tablero — mismo proyecto"
                  dotColor="bg-orange-500"
                  entries={sameProjectOtherBoardEntries}
                />
              )}

              {/* ── Section: Otros proyectos ── */}
              {otherProjectEntries.length > 0 && (
                <HistorySection
                  label={`Otros estudios (${otherProjectEntries.length})`}
                  dotColor={hasParticipated ? 'bg-destructive' : 'bg-yellow-500'}
                  entries={otherProjectEntries}
                />
              )}

            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function MatchedByBadgesInline({ matchedBy }: { matchedBy: string[] }) {
  const labels: Record<string, string> = { email: 'email', name: 'nombre', phone: 'teléfono' };
  return <span className="text-muted-foreground">{matchedBy.map(k => labels[k] ?? k).join(', ')}</span>;
}

function HistorySection({ label, dotColor, entries, isCurrentBoard }: {
  label: string;
  dotColor: string;
  entries: HistoryEntry[];
  isCurrentBoard?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="space-y-2">
        {entries.map((h, i) => <HistoryEntryCard key={i} h={h} isCurrentBoard={isCurrentBoard} />)}
      </div>
    </div>
  );
}

// ── Fillout Link Dialog ───────────────────────────────────────────────────────
type FilloutForm = GetFilloutFormsOutputType['forms'][0];
type ImportPhase = 'idle' | 'counting' | 'found' | 'importing' | 'done';

function StepRow({ state, label, detail }: { state: 'done' | 'active' | 'pending'; label: string; detail?: string }) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 transition-opacity ${state === 'pending' ? 'opacity-35' : 'opacity-100'}`}>
      <div className="flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center">
        {state === 'done'    && <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />}
        {state === 'active'  && <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
        {state === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-border/60" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-5 ${state !== 'pending' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          {label}
        </p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function FilloutLinkDialog({ open, onOpenChange, boardId, projectCode, boardName, onLinked, onImportDone, busyRef }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boardId: string;
  projectCode: string;
  boardName: string;
  onLinked: () => void;
  onImportDone: (count: number) => void;
  busyRef: React.MutableRefObject<boolean>;
}) {
  const [forms, setForms] = useState<FilloutForm[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [selectedForm, setSelectedForm] = useState<FilloutForm | null>(null);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [result, setResult] = useState<{ columnsCreated: number } | null>(null);
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  const [foundCount, setFoundCount] = useState(0);
  const [importedCount, setImportedCount] = useState(0);

  useEffect(() => {
    if (!open) {
      setResult(null); setSelectedForm(null); setSearch('');
      setImportPhase('idle'); setFoundCount(0); setImportedCount(0);
      return;
    }
    setLoadingForms(true);
    getFilloutForms({}).then(d => { setForms(d.forms); setLoadingForms(false); })
      .catch(() => { toast.error('No se pudieron cargar los formularios de Fillout'); setLoadingForms(false); });
  }, [open]);

  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return forms.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10);
  }, [search, forms]);

  const handleLink = async () => {
    if (!selectedForm) return;
    setLinking(true);
    try {
      const res = await linkFilloutForm({ formId: selectedForm.formId, formName: selectedForm.name, boardId, projectCode, boardName });
      setResult({ columnsCreated: res.columnsCreated });
      setLinking(false);
      onLinked();

      // ── Phase: counting ──────────────────────────────────────────────
      busyRef.current = true;
      setImportPhase('counting');
      const countRes = await countFilloutSubmissions({ boardId });

      if (countRes.newCount === 0) {
        setImportPhase('done');
        busyRef.current = false;
        onImportDone(0);
        return;
      }

      setFoundCount(countRes.newCount);
      setImportPhase('found');
      await new Promise(r => setTimeout(r, 750)); // Let user see "X encontradas"

      // ── Phase: importing ───────────────────────────────────────────────
      // checkNewSubmissions transmite progreso real por SSE (ver
      // server/index.ts + server/compat/endpoint.ts) — cada chunk trae cuántas
      // van importadas de cuántas en total, así la barra avanza de verdad en
      // vez de saltar de 0% a 100% al terminar.
      setImportPhase('importing');
      const importStream = checkNewSubmissions({ boardId });
      for await (const chunk of importStream) {
        setImportedCount(chunk.imported);
        if (chunk.total) setFoundCount(chunk.total);
      }
      const finalRes = await importStream;
      setImportedCount(finalRes.newCount);
      setImportPhase('done');
      busyRef.current = false;
      onImportDone(finalRes.newCount);
    } catch (err) {
      console.error('[RecruitmentPage] Error al vincular formulario de Fillout:', err);
      toast.error('Error al vincular el formulario');
      setImportPhase('idle');
      setResult(null);
      setLinking(false);
      busyRef.current = false;
    }
  };

  const progressPct = foundCount > 0 ? Math.round((importedCount / foundCount) * 100) : 0;
  const isProcessing = importPhase === 'counting' || importPhase === 'found' || importPhase === 'importing';

  const step2State: 'active' | 'done' | 'pending' =
    importPhase === 'counting' ? 'active' :
    importPhase === 'idle'     ? 'pending' : 'done';

  const step3State: 'active' | 'done' | 'pending' =
    importPhase === 'importing' ? 'active' :
    importPhase === 'done' && foundCount > 0 ? 'done' : 'pending';

  const step2Label =
    importPhase === 'counting'                    ? 'Buscando respuestas...' :
    importPhase === 'done' && foundCount === 0    ? 'Sin respuestas nuevas por ahora' :
    foundCount > 0                                ? `${foundCount} respuesta${foundCount !== 1 ? 's' : ''} encontrada${foundCount !== 1 ? 's' : ''}` :
    'Buscando respuestas...';

  const step3Label = importPhase === 'done'
    ? `${importedCount} respuesta${importedCount !== 1 ? 's' : ''} importada${importedCount !== 1 ? 's' : ''} ✓`
    : `Importando respuestas... (${importedCount}/${foundCount})`;

  return (
    <Dialog open={open} onOpenChange={v => { if (!isProcessing) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" /> Vincular formulario de Fillout
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          /* ── Form selection ─────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2.5 text-sm">
              <p className="text-xs text-muted-foreground mb-0.5">Las respuestas llegarán a</p>
              <p className="font-semibold text-foreground">
                Tablero <span className="text-primary">"{boardName}"</span>
                {projectCode && <span className="text-muted-foreground font-normal"> · {projectCode}</span>}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Formulario de Fillout</Label>
              {loadingForms ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  Cargando formularios...
                </div>
              ) : selectedForm ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-primary/40 bg-primary/5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="flex-1 text-sm font-medium truncate">{selectedForm.name}</span>
                  <button onClick={() => { setSelectedForm(null); setSearch(''); }} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Escribe para buscar un formulario..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="text-sm"
                    autoFocus
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                      {suggestions.map(f => (
                        <button
                          key={f.formId}
                          onClick={() => { setSelectedForm(f); setSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors truncate"
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {search.trim() && suggestions.length === 0 && (
                    <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-md px-3 py-3 text-sm text-muted-foreground text-center">
                      Sin resultados para "{search}"
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-xs">Al vincular:</p>
              <p>✦ Se leerán las preguntas del formulario</p>
              <p>✦ Se crearán columnas dinámicas automáticamente</p>
              <p>✦ Cada respuesta creará una fila en este tablero</p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleLink} disabled={!selectedForm || linking} className="gap-2">
                {linking ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                {linking ? 'Vinculando...' : 'Vincular'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Progress / Result ──────────────────────────────────────── */
          <div className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/30 overflow-hidden">

              {/* Step 1: Form linked + columns */}
              <StepRow
                state="done"
                label="Formulario vinculado"
                detail={result.columnsCreated > 0
                  ? `${result.columnsCreated} columna${result.columnsCreated !== 1 ? 's' : ''} creada${result.columnsCreated !== 1 ? 's' : ''} en el tablero`
                  : 'Columnas ya existentes'}
              />

              {/* Step 2: Counting */}
              <StepRow state={step2State} label={step2Label} />

              {/* Step 3: Importing (only when there are submissions to import) */}
              {foundCount > 0 && (
                <div>
                  <StepRow
                    state={step3State}
                    label={step3Label}
                    detail={importPhase === 'importing' ? `${progressPct}% completado` : undefined}
                  />
                  {importPhase === 'importing' && (
                    <div className="px-4 pb-3.5 -mt-1">
                      <Progress value={progressPct} className="h-1.5" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Note when no submissions found */}
            {importPhase === 'done' && foundCount === 0 && (
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse flex-shrink-0" />
                Se revisará automáticamente cada ~45 segundos
              </p>
            )}

            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                disabled={importPhase !== 'done'}
                className="gap-1.5 min-w-[90px]"
              >
                {importPhase !== 'done'
                  ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Procesando...</>
                  : <><CheckCircle2 className="w-3.5 h-3.5" /> Listo</>
                }
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── General-view hidden columns persistence helpers ───────────────────────────
const getGeneralHiddenColsKey = (boardId: string) => `recruit-hidden-cols-${boardId}`;

const loadGeneralHiddenColumns = (boardId: string): Set<string> => {
  try {
    const saved = localStorage.getItem(getGeneralHiddenColsKey(boardId));
    return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

// ── Main RecruitmentPage ──────────────────────────────────────────────────────
export default function RecruitmentPage({ hasMuestra, onOpenMuestra }: { hasMuestra?: boolean; onOpenMuestra?: () => void } = {}) {
  const { selectedProject, projects } = useProject();
  const { user } = useAuth();
  const presence = useProjectPresence({ projectCode: selectedProject, pageName: 'recruitment', enabled: !!selectedProject && !!user, user: user ?? undefined });
  const [rows,        setRows]        = useState<Row[]>([]);
  const [boards,      setBoards]      = useState<string[]>([]);
  const [boardObjects, setBoardObjects] = useState<BoardObj[]>([]);
  const [activeBoardId, setActiveBoardId] = useState('');
  const [loading,     setLoading]     = useState(true);
  const [open,        setOpen]        = useState(false);
  const [editing,     setEditing]     = useState<Row | null>(null);
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [bulkDeletingIds, setBulkDeletingIds] = useState<string[]>([]);
  const [form,        setForm]        = useState({ ...emptyForm });
  const [saving,      setSaving]      = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [duplicateSearchOpen,  setDuplicateSearchOpen]  = useState(false);
  const [newBoardName,  setNewBoardName]  = useState('');
  const [addingBoard,   setAddingBoard]   = useState(false);
  // renamingBoard/renameValue removed — BoardTabsBar handles rename state internally
  // dragTabIdxRef/dragOverTabIdx removed — BoardTabsBar handles tab drag state internally
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [duplicateHistoryRow, setDuplicateHistoryRow] = useState<Row | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const [badgeMap, setBadgeMap] = useState<Record<string, RowBadgeInfo>>({});
  const [badgeVersion, setBadgeVersion] = useState(0);
  const [deletingBoard, setDeletingBoard] = useState<string | null>(null);
  const [deletingBoardName, setDeletingBoardName] = useState('');
  const [trashOpen, setTrashOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('recruit-compact') === '1');
  const toggleCompact = () => setCompactMode(prev => { const next = !prev; localStorage.setItem('recruit-compact', next ? '1' : '0'); return next; });

  const [activeView, setActiveView] = useState<InternalView | null>(null);
  const internalViewsBarRef = useRef<InternalViewsBarHandle>(null);
  const busyRef = useRef(false);
  const isReloadingRef  = useRef(false);
  const lastReloadRef   = useRef<number>(0);
  const reloadTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeBoardName = useMemo(() => boardObjects.find(b => b.id === activeBoardId)?.name ?? '', [boardObjects, activeBoardId]);
  // ── localStorage hidden-columns: UUID-first with legacy migration ──
  const hiddenColsStorageKey = useMemo(() => {
    if (activeBoardId) return activeBoardId;
    return activeBoardName ? `recruitment-${selectedProject ?? 'all'}-${activeBoardName}` : '';
  }, [activeBoardId, activeBoardName, selectedProject]);

  // ── Ably realtime: listen for recruitment row deletes from other users ────
  useRealtimeBoardEvents({
    projectCode: selectedProject,
    userEmail: user?.email ?? '',
    enabled: !!selectedProject && !!user,
    onRecruitmentDeleted: (payload) => {
      setRows(prev => prev.filter(r => r.id !== payload.id && r.parentRowId !== payload.id));
    },
    onRecruitmentRowsChanged: (payload) => {
      console.log('[recruitment] rows changed via Ably', payload);
      groupDynCols.softReload();
      scheduleRecruitmentReload('ably:recruitmentRowsChanged');
    },
  onRecruitmentGroupsChanged: (payload) => {
      if ((payload as any)?.changeType === 'membership') {
        console.log('[groups] onRecruitmentGroupsChanged → softReload() for membership change');
        groupDynCols.softReload();
        return;
      }
      console.log('[groups] onRecruitmentGroupsChanged → refreshColumns() for structure change');
      groupDynCols.refreshColumns();
    },
    onBoardFieldUpdated: (payload: BoardFieldUpdatedPayload) => {
      if (payload.fieldType === 'dynamic' && payload.columnId && payload.value) {
        const bid = payload.boardId;
        if (!activeBoardId) return;
        const isMainBoard  = bid === activeBoardId;
        const isGroupBoard = bid === `${activeBoardId}::groups`;

        if (isMainBoard) {
          dynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        } else if (isGroupBoard) {
          groupDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        }
      } else if (payload.fieldType === 'fixed' && payload.fields) {
        setRows(prev => prev.map(r =>
          r.id === payload.rowId ? { ...r, ...payload.fields } : r
        ));
      }
    },
  });

  // ── Batch badge fetch — single source of truth for row icons ─────────────
  // Debounce badgeVersion so rapid saves don't spam the endpoint
  const [debouncedBadgeVersion, setDebouncedBadgeVersion] = useState(0);
  const badgeDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (badgeDebounceRef.current) clearTimeout(badgeDebounceRef.current);
    badgeDebounceRef.current = setTimeout(() => setDebouncedBadgeVersion(badgeVersion), 2000);
    return () => { if (badgeDebounceRef.current) clearTimeout(badgeDebounceRef.current); };
  }, [badgeVersion]);

  useEffect(() => {
    if (!selectedProject || !activeBoardName) { setBadgeMap({}); return; }
    let cancelled = false;
    getBoardDuplicateBadges({ projectCode: selectedProject, boardName: activeBoardName })
      .then(res => { if (!cancelled) setBadgeMap(res.badges); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject, activeBoardName, debouncedBadgeVersion]);
  const [linkedEventsMap, setLinkedEventsMap] = useState<Record<string, { eventName?: string; eventDate?: string; durationHours?: number; location?: string }>>({});
  const [linkedEventsRefreshTick, setLinkedEventsRefreshTick] = useState(0);
  const [createEventDialog, setCreateEventDialog] = useState<{ groupId: string; groupName: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  // ── Stagger column loads to spread the request burst on cold-cache board switch ──
  // dynCols fires immediately (critical path). groups start after 250 ms.
  // State is keyed by boardId so switching boards instantly resets enabled to false
  // without needing an extra setState call — avoids stale-closure / flash issues.
  // R2-B: stagger logic keyed on activeBoardId (UUID), not legacy composite
  const [groupColsBoard, setGroupColsBoard] = useState<string | null>(null);
  const groupColsEnabled = groupColsBoard === activeBoardId && !!activeBoardId;
  useEffect(() => {
    if (!activeBoardId) { setGroupColsBoard(null); return; }

    // Fast path: if rows are already cached for this board (re-visit or prefetch hit),
    // enable groups immediately — no stagger needed, we want groups ASAP
    // so hasInitiallyLoaded resolves quickly and the table renders without skeleton.
    const rowsCacheKey = `${selectedProject}::uuid::${activeBoardId}`;
    const hasRowsCache = rowsCache.has(rowsCacheKey);
    if (hasRowsCache) {
      setGroupColsBoard(activeBoardId);
      return;
    }

    // Cold start: stagger to spread the request burst
    const groupsCached = isBoardCached(`${activeBoardId}::groups`);
    if (groupsCached) { setGroupColsBoard(activeBoardId); return; }
    const t1 = setTimeout(() => setGroupColsBoard(activeBoardId), 250);
    return () => clearTimeout(t1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId]);

  // R2-B: useDynamicColumns uses UUID (activeBoardId) for all operational columns
  const dynCols      = useDynamicColumns(activeBoardId, rows);
  const groupDynCols = useDynamicColumns(activeBoardId ? `${activeBoardId}::groups`   : '', undefined, { enabled: groupColsEnabled });

  // ── Prefetch rows of neighboring boards so tab-switching feels instant ─────
  useEffect(() => {
    if (!activeBoardId || loading || !groupDynCols.hasInitiallyLoaded || boardObjects.length <= 1 || !selectedProject) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const idx = boardObjects.findIndex(b => b.id === activeBoardId);
      if (idx === -1) return;
      const neighbors: { id: string; name: string }[] = [];
      if (idx > 0) neighbors.push(boardObjects[idx - 1]);
      if (idx < boardObjects.length - 1) neighbors.push(boardObjects[idx + 1]);
      (async () => {
        for (const neighbor of neighbors) {
          if (cancelled) break;
          const key = `${selectedProject}::uuid::${neighbor.id}`;
          if (rowsCache.has(key) || prefetchInFlight.has(key)) continue;
          prefetchInFlight.add(key);
          try {
            const d = await getRecruitmentRows({ projectCode: selectedProject, boardId: neighbor.id, boardName: neighbor.name });
            if (!cancelled) rowsCache.set(key, d.rows);
          } catch { /* silent — prefetch is best-effort */ }
          prefetchInFlight.delete(key);
        }
      })();
    }, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeBoardId, loading, groupDynCols.hasInitiallyLoaded, boardObjects, selectedProject]);

  // ── Batch-fetch linked event info for all groups with a linkedCalEvent ─────
  // Derive a stable string key from group columns so the effect only re-fires
  // when the actual set of linked event IDs changes, not on every columns ref change.
  const linkedEventIdsKey = useMemo(() => {
    const ids: string[] = [];
    for (const col of groupDynCols.columns) {
      try {
        const opts = JSON.parse(col.optionsJson ?? '{}');
        if (opts?.linkedCalEvent?.eventId) ids.push(opts.linkedCalEvent.eventId);
      } catch { /* skip */ }
    }
    return [...new Set(ids)].sort().join(',');
  }, [groupDynCols.columns]);

  useEffect(() => {
    if (!linkedEventIdsKey) return;
    const unique = linkedEventIdsKey.split(',');
    let cancelled = false;
    getLinkedEventsInfo({ eventIds: unique })
      .then(res => { if (!cancelled) setLinkedEventsMap(res.events); })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [linkedEventIdsKey, linkedEventsRefreshTick]);

  const handleSync = async (silent = false) => {
    if (!activeBoardId || !dynCols.linkedFormInfo) return;
    busyRef.current = true;
    if (!silent) setSyncing(true);
    try {
      const res = await syncFilloutResponses({ boardId: activeBoardId });
      if (!silent) {
        if (res.imported > 0) {
          toast.success(`${res.imported} respuesta${res.imported !== 1 ? 's' : ''} nueva${res.imported !== 1 ? 's' : ''} importada${res.imported !== 1 ? 's' : ''}`);
        } else {
          toast.info('Sin respuestas nuevas');
        }
      }
      if (res.imported > 0) silentReload();
      setLastSyncTime(new Date());
    } catch (err) {
      console.error('[RecruitmentPage] Error al sincronizar con Fillout:', err);
      if (!silent) toast.error('Error al sincronizar con Fillout');
    }
    busyRef.current = false;
    if (!silent) setSyncing(false);
  };

  // Lightweight delta-polling when a form is linked.
  // Uses checkNewSubmissions (cursor-based, fast path if nothing new).
  // Uses a recursive setTimeout with exponential backoff on failure to avoid
  // aggravating rate limits: delay doubles on each error (max 5 min).
  useEffect(() => {
    if (!activeBoardId || !dynCols.linkedFormInfo) return;

    const BASE_DELAY = 45_000;
    const MAX_DELAY  = 5 * 60_000;
    let currentDelay = BASE_DELAY;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = (delay: number) => {
      timeoutId = setTimeout(runCheck, delay);
    };

    async function runCheck() {
      if (cancelled) return;
      if (busyRef.current) { if (!cancelled) schedule(currentDelay); return; }
      try {
        const res = await checkNewSubmissions({ boardId: activeBoardId });
        if (res.newCount > 0) {
          silentReload();
          setLastSyncTime(new Date());
          toast.success(`${res.newCount} respuesta${res.newCount !== 1 ? 's' : ''} nueva${res.newCount !== 1 ? 's' : ''}`);
        }
        // Success — reset to base delay
        currentDelay = BASE_DELAY;
      } catch {
        // Failure (e.g. rate limit) — back off exponentially
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
      }
      if (!cancelled) schedule(currentDelay);
    }

    // First poll after 10s to not compete with initial page-load requests
    schedule(10_000);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [activeBoardId, !!dynCols.linkedFormInfo]);

  const groupNames = useMemo(
    () => [...groupDynCols.columns.map(g => g.columnName ?? 'Sin nombre'), 'Sin grupo'],
    [groupDynCols.columns]
  );

  const allColumns = useMemo(() => [
    ...RECRUIT_COLS,
    ...DUP_BADGE_COLS,
    { key: '_group', label: 'Grupo', type: 'select' as const, options: groupNames },
    ...dynCols.columns.map(dynColToFilterCol),
  ], [dynCols.columns, groupNames]);



  const load = (boardOverride?: string, boardIdOverride?: string) => {
    const board = boardOverride !== undefined ? boardOverride : activeBoardName;
    const boardIdToUse = boardIdOverride !== undefined ? boardIdOverride : activeBoardId;
    // R2-B: UUID-based cache key when boardIdToUse exists, legacy fallback otherwise
    const cacheKey = boardIdToUse ? `${selectedProject}::uuid::${boardIdToUse}` : `${selectedProject}::${board}`;
    const cached = rowsCache.get(cacheKey);

    // R2-B: send boardId (UUID) alongside boardName for compat
    const fetcher = () => getRecruitmentRows({ projectCode: selectedProject ?? undefined, boardId: boardIdToUse || undefined, boardName: board || undefined });

    if (cached) {
      // Instant render from cache, refresh silently in background (best-effort, no retry needed)
      setRows(cached);
      fetcher().then(d => {
        rowsCache.set(cacheKey, d.rows);
        setBoardObjects((d.boardObjects ?? []).map(b => ({ id: b.id, name: b.name, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 })));
        // Only re-render if data actually changed
        if (JSON.stringify(d.rows) !== JSON.stringify(cached)) setRows(d.rows);
        // Only update boards list when fetching all boards (no boardName)
        if (!board && d.boards.length > 0) setBoards(d.boards);
      }).catch(() => { /* non-critical — cached data is already shown */ });
    } else {
      // No cache: show skeleton then fetch, with retry on rate-limit errors
      setLoading(true);

      const tryFetch = async (attempt: number): Promise<void> => {
        try {
          const d = await fetcher();
          rowsCache.set(cacheKey, d.rows);
          setRows(d.rows);
          setBoardObjects((d.boardObjects ?? []).map(b => ({ id: b.id, name: b.name, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 })));
          if (!board) {
            setBoards(d.boards);
            if (d.boards.length > 0 && (d.boardObjects ?? []).length > 0) {
              const firstObj = (d.boardObjects ?? [])[0];
              setBoardObjects((d.boardObjects ?? []).map(b => ({ id: b.id, name: b.name, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 })));
              setActiveBoardId(firstObj.id);
              load(firstObj.name, firstObj.id);
              return; // inner load() will call setLoading(false)
            }
          }
          setLoading(false);
        } catch (err) {
          const msg = (err as Error)?.message ?? '';
          const isRateLimit = msg.includes('Too many requests') || msg.includes('429');
          if (attempt < 2 && isRateLimit) {
            // Exponential backoff: 3s, 6s
            const delay = 3000 * Math.pow(2, attempt);
            console.warn(`[recruitment] rate limited loading "${board}", retrying in ${delay}ms (attempt ${attempt + 1})`);
            setTimeout(() => tryFetch(attempt + 1), delay);
          } else {
            console.error('[recruitment] load() failed after retries:', err);
            setLoading(false);
            toast.error('Error al cargar participantes. Intenta de nuevo o recarga la página.');
          }
        }
      };

      tryFetch(0);
    }
  };

  const safeReload = async (reason: string, board?: string, boardIdParam?: string) => {
    const now = Date.now();
    if (isReloadingRef.current) {
      console.log('[recruitment] reload skipped, already loading', reason);
      return;
    }
    if (now - lastReloadRef.current < 5000) {
      console.log('[recruitment] reload skipped, cooldown', reason);
      return;
    }
    const target = board !== undefined ? board : activeBoardName;
    const bidToUse = boardIdParam !== undefined ? boardIdParam : activeBoardId;
    // R2-B: UUID cache key when available
    const cacheKey = bidToUse ? `${selectedProject}::uuid::${bidToUse}` : `${selectedProject}::${target}`;
    isReloadingRef.current = true;
    lastReloadRef.current = now;
    console.log('[recruitment] fetching rows', reason);
    try {
      const d = await getRecruitmentRows({ projectCode: selectedProject ?? undefined, boardId: bidToUse || undefined, boardName: target || undefined });
      rowsCache.set(cacheKey, d.rows);
      setRows(d.rows);
      setBoardObjects((d.boardObjects ?? []).map(b => ({ id: b.id, name: b.name, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 })));
      setBadgeVersion(v => v + 1);
    } catch (error) {
      const msg = (error as Error)?.message ?? '';
      if (msg.includes('Too many requests') || msg.includes('429')) {
        // Rate limited — extend the cooldown by an extra 10s so the next
        // Ably event doesn't immediately fire another doomed request
        console.warn('[recruitment] rate limited, extending cooldown to 15s', { reason });
        lastReloadRef.current = Date.now() + 10000;
      } else {
        console.warn('[recruitment] getRecruitmentRows failed, keeping current rows', { reason, error });
      }
    } finally {
      isReloadingRef.current = false;
    }
  };

  const scheduleRecruitmentReload = (reason: string) => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => { safeReload(reason); }, 1500);
  };

  const silentReload = (board?: string) => {
    return safeReload('silentReload', board);
  };

  const fetchRowsOnly = () => {
    return getRecruitmentRows({ projectCode: selectedProject ?? undefined, boardId: activeBoardId || undefined, boardName: activeBoardName || undefined }).then(d => d.rows);
  };

  useEffect(() => { rowsCache.clear(); setActiveBoardId(''); setActiveView(null); setExpandedGroups(new Set(['__none__'])); load('', ''); }, [selectedProject]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current); };
  }, []);

  // All top-level rows for the active board (UUID-first with name fallback)
  const allBoardRows = useMemo(() => rows.filter(r => {
    if (activeBoardId && r.boardId) return r.boardId === activeBoardId;
    return r.boardName === activeBoardName;
  }), [rows, activeBoardName, activeBoardId]);

  // Flatten virtual _group + dynamic column cell values onto each row so
  // useTableFilters can find values by column ID key
  const rowsWithGroup = useMemo(() => allBoardRows.map(row => {
    const groupCol = groupDynCols.columns.find(g => groupDynCols.getCellVal(row.id, g.id)?.textValue === '1');
    const dynValues: Record<string, string> = {};
    for (const col of dynCols.columns) {
      const val = cellDisplayValue(dynCols.getCellVal(row.id, col.id), col.columnType);
      if (val) dynValues[col.id] = val;
    }
    return {
      ...row,
      _group: groupCol?.columnName ?? 'Sin grupo',
      _dupBoard: dupBadgeValue(row.id, '_dupBoard', badgeMap),
      _dupHistory: dupBadgeValue(row.id, '_dupHistory', badgeMap),
      _dupRisk: dupBadgeValue(row.id, '_dupRisk', badgeMap),
      ...dynValues,
    };
  // getCellVal is stable (useCallback[cellMap]) — changes when cells load/update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allBoardRows, groupDynCols.columns, groupDynCols.getCellVal, dynCols.columns, dynCols.getCellVal, badgeMap]);

  // Filter hook
  const { filteredData, columnFilters, setColFilter, colUniqueValues, advancedFilters, setAdvancedFilters, filterMode, setFilterMode, activeFilterCount, clearAllFilters, applyViewFilters, serializeFilters, hiddenColumns, setHiddenColumns, toggleColumn, sortColumn, sortDirection, toggleSort } = useTableFilters(rowsWithGroup, allColumns);

  // ── Hidden columns: UUID key with legacy migration ──────────────────────
  useEffect(() => {
    if (!hiddenColsStorageKey || activeView !== null) return;
    // Try UUID key first
    let cols = loadGeneralHiddenColumns(hiddenColsStorageKey);
    // If empty and we have a UUID, try legacy key and migrate
    if (cols.size === 0 && activeBoardId && activeBoardName && selectedProject) {
      const legacyKey = `recruitment-${selectedProject}-${activeBoardName}`;
      if (legacyKey !== hiddenColsStorageKey) {
        cols = loadGeneralHiddenColumns(legacyKey);
        if (cols.size > 0) {
          // Migrate: save under UUID key, remove legacy key
          localStorage.setItem(getGeneralHiddenColsKey(hiddenColsStorageKey), JSON.stringify([...cols]));
          localStorage.removeItem(getGeneralHiddenColsKey(legacyKey));
        }
      }
    }
    setHiddenColumns(cols);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenColsStorageKey]);

  // ── Persist hidden columns for "Todos" view ───────────────────────────────
  useEffect(() => {
    if (activeView !== null) return;
    if (!hiddenColsStorageKey) return;
    const key = getGeneralHiddenColsKey(hiddenColsStorageKey);
    if (hiddenColumns.size > 0) {
      localStorage.setItem(key, JSON.stringify([...hiddenColumns]));
    } else {
      localStorage.removeItem(key);
    }
  }, [hiddenColumns, activeView, hiddenColsStorageKey]);

  // Compute which group names are allowed based on active group filters
  const activeGroupFilter = useMemo((): Set<string> | null => {
    const names = new Set<string>();
    const colGroupFilter = columnFilters['_group'];
    if (colGroupFilter && colGroupFilter.size > 0) {
      colGroupFilter.forEach(v => names.add(v));
    }
    for (const rule of advancedFilters) {
      if ((rule as any).column === '_group') {
        const op = (rule as any).operator;
        if (op === 'es' && (rule as any).value) {
          names.add((rule as any).value);
        } else if (op === 'es_alguno' && (rule as any).selectedValues) {
          ((rule as any).selectedValues as string[]).forEach(v => names.add(v));
        }
      }
    }
    return names.size > 0 ? names : null;
  }, [columnFilters, advancedFilters]);

  // Apply text search on top.
  // Fast path: when no filters and no search are active, skip the filter
  // pipeline entirely and use the board-scoped rows directly so an optimistic
  // setRows() update is visible in the very same render cycle.
  const boardRows = useMemo(() => {
    if (!filterSearch && activeFilterCount === 0) return allBoardRows;
    if (!filterSearch) return filteredData;
    const q = filterSearch.toLowerCase();
    return filteredData.filter(r =>
      [r.participantName, r.email, r.phone, r.idNumber, r.notes].some(v => v?.toLowerCase().includes(q))
    );
  }, [allBoardRows, filteredData, filterSearch, activeFilterCount]);

  const totalActiveFilters = activeFilterCount + (filterSearch ? 1 : 0);
  const handleClearAll = () => { clearAllFilters(); setFilterSearch(''); setActiveView(null); };

  const handleViewUpdated = useCallback((view: InternalView) => { setActiveView(view); }, []);

  const handleSaveCurrentView = async () => {
    if (!activeView) return;
    try {
      await saveInternalView({
        id: activeView.id,
        viewName: activeView.viewName,
        boardId: activeBoardId,
        projectCode: selectedProject ?? '',
        boardName: activeBoardName,
        filtersJson: currentFiltersJson,
      });
      const updated = { ...activeView, filtersJson: currentFiltersJson };
      setActiveView(updated);
      internalViewsBarRef.current?.notifyViewSaved(activeView.id, currentFiltersJson);
      toast.success(`Vista "${activeView.viewName}" guardada`);
    } catch {
      toast.error('Error al guardar la vista');
    }
  };

  const handleViewSelected = useCallback((view: InternalView | null) => {
    setActiveView(view);
    setFilterSearch('');
    if (view) {
      applyViewFilters(view.filtersJson);
    } else {
      clearAllFilters();
      setHiddenColumns(loadGeneralHiddenColumns(hiddenColsStorageKey));
    }
  }, [applyViewFilters, clearAllFilters, setHiddenColumns, hiddenColsStorageKey]);

  // Serialize current filter state (filters + column visibility) for saving/updating views
  const currentFiltersJson = useMemo(
    () => serializeFilters(advancedFilters, filterMode, columnFilters, hiddenColumns, sortColumn, sortDirection),
    [serializeFilters, advancedFilters, filterMode, columnFilters, hiddenColumns, sortColumn, sortDirection]
  );
  const hasUnsavedViewChanges = activeView !== null && currentFiltersJson !== activeView.filtersJson;

  // Handlers
  const saveName = async (id: string, name: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, participantName: name, rowName: name } : r));
    try { await saveRecruitmentRow({ id, participantName: name, rowName: name }); setBadgeVersion(v => v + 1); }
    catch { toast.error('Error al guardar'); silentReload(); }
  };

  const saveField = async (id: string, field: 'email' | 'phone' | 'idNumber', value: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    try { await saveRecruitmentRow({ id, [field]: value }); setBadgeVersion(v => v + 1); }
    catch { toast.error('Error al guardar'); silentReload(); }
  };

  // R2-B: strict UUID writes — no legacy fallback
  const quickCreate = async (name: string, groupId?: string) => {
    if (!activeBoardId) { toast.error('No hay tablero activo'); return; }
    const tempId = 'temp-' + Date.now();
    setRows(prev => [...prev, { id: tempId, rowName: name, participantName: name, boardName: activeBoardName, boardId: activeBoardId, status: 'Pendiente', level: 0 } as Row]);
    if (groupId) groupDynCols.setCellVal(tempId, groupId, { textValue: '1' });
    try {
      const res = await saveRecruitmentRow({ rowName: name, participantName: name, projectCode: selectedProject ?? undefined, boardId: activeBoardId, boardName: activeBoardName, status: 'Pendiente', level: 0 });
      if (res.id) setRows(prev => prev.map(r => r.id === tempId ? { ...r, id: res.id } : r));
      if (groupId && res.id) await groupDynCols.setCellVal(res.id, groupId, { textValue: '1' });
      if (res.id) {
        publishRecruitmentRowsChanged({
          projectCode: selectedProject ?? '',
          boardId: activeBoardId,
          rowId: res.id,
          changeType: 'created',
        }).catch(() => {});
      }
    } catch { toast.error('Error al crear'); setRows(prev => prev.filter(r => r.id !== tempId)); }
  };

  // R2-B: publish groups uses activeBoardId (UUID)
  const publishGroupChange = () => {
    console.log('[groups] publishGroupChange called', { selectedProject, activeBoardId });
    if (!selectedProject || !activeBoardId) {
      console.warn('[groups] publishGroupChange skipped: missing selectedProject or activeBoardId');
      return;
    }
    publishRecruitmentGroupsChanged({
      projectCode: selectedProject,
      boardId: `${activeBoardId}::groups`,
      changeType: 'structure',
    }).catch((err) => {
      console.error('[groups] publishRecruitmentGroupsChanged failed', err);
    });
  };

  const createGroup = async () => {
    if (!activeBoardId) { toast.error('No hay tablero activo'); return; }
    console.log('[groups] createGroup called', { selectedProject, activeBoardId });
    const n = groupDynCols.columns.length;
    const families = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const family = families[n % families.length];
    const shade = Math.floor(n / families.length) % 5 + 1;
    try {
      const realId = await groupDynCols.addColumn(`Grupo ${n + 1}`, `${family}-${shade}`);
      console.log('[groups] addColumn persisted, realId:', realId);
      publishGroupChange();
    } catch (err) {
      console.error('[groups] addColumn failed, skipping publish', err);
    }
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({ rowName: row.rowName ?? '', participantName: row.participantName ?? '', email: row.email ?? '', phone: row.phone ?? '', idNumber: row.idNumber ?? '', status: row.status ?? 'Pendiente', notes: row.notes ?? '', boardName: row.boardName ?? activeBoardName });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveRecruitmentRow({ ...form, rowName: form.rowName || form.participantName || 'Sin nombre', projectCode: selectedProject ?? undefined, boardId: activeBoardId || undefined, id: editing?.id });
      if (!editing && activeBoardId) {
        publishRecruitmentRowsChanged({
          projectCode: selectedProject ?? '',
          boardId: activeBoardId,
          rowId: res.id,
          changeType: 'created',
        }).catch(() => {});
      }
      toast.success('Guardado'); setOpen(false); silentReload();
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const del = async () => {
    if (!deleting) return;
    const deletingId = deleting;
    const prev = rows;
    setRows(r => r.filter(x => x.id !== deletingId && x.parentRowId !== deletingId));
    setDeleting(null);
    toast.success('Eliminado');
    try {
      await deleteRecruitmentRow({ id: deletingId });
    } catch {
      setRows(prev);
      toast.error('Error al eliminar');
    }
  };

  const updateStatus = async (id: string, status: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    await saveRecruitmentRow({ id, status });
    setBadgeVersion(v => v + 1);
  };

  const sendNDA = async (id: string) => { await markNDASent({ id }); toast.success('NDA marcado como enviado'); silentReload(); };

  const handleCreateEventForGroup = async (groupId: string) => {
    if (!selectedProject) return;
    const groupName = groupDynCols.columns.find(g => g.id === groupId)?.columnName ?? 'Nuevo evento';
    setCreateEventDialog({ groupId, groupName });
  };

  const confirmDeleteBoard = () => {
    if (!deletingBoard || !selectedProject) return;
    const uuid = deletingBoard;
    const boardLabel = deletingBoardName;

    // ── Optimistic update: close dialog and update UI immediately ──
    const remainingObjects = boardObjects.filter(b => b.id !== uuid);
    const remaining = boards.filter(b => b !== boardLabel);
    setBoards(remaining);
    setBoardObjects(remainingObjects);
    setActiveBoardId(remainingObjects[0]?.id ?? '');
    setDeletingBoard(null);
    setDeletingBoardName('');
    toast.info('Eliminando tablero en segundo plano...');

    // ── Fire-and-forget backend cleanup ───────────────────────────
    busyRef.current = true;
    deleteBoard({ boardId: uuid, boardName: boardLabel, projectCode: selectedProject })
      .then(() => { busyRef.current = false; toast.success(`Tablero "${boardLabel}" eliminado`); })
      .catch(() => { busyRef.current = false; toast.error('Error al eliminar — algunos datos pueden quedar huérfanos'); });
  };

  const reorderBoards = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...boardObjects];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setBoardObjects(reordered);
    setBoards(reordered.map(b => b.name));
    reordered.forEach((b, i) => {
      saveBoard({ boardId: b.id, boardName: b.name, projectCode: selectedProject ?? '', boardOrder: i }).catch(() => {});
    });
  };

  const addBoard = async () => {
    if (!newBoardName.trim()) return;
    const name = newBoardName.trim();
    if (boards.some(b => b.toLowerCase() === name.toLowerCase())) {
      toast.warning(`Ya existe un tablero llamado "${name}". Se creará otro con el mismo nombre.`);
    }
    setAddingBoard(false);
    setNewBoardName('');
    try {
      const res = await saveBoard({
        boardName: name,
        projectCode: selectedProject ?? '',
        boardOrder: boardObjects.length,
        boardType: 'recruitment',
        forceCreate: true,
      });
      const newObj: BoardObj = { id: res.id, name: res.boardName ?? name, boardType: 'recruitment', boardOrder: boardObjects.length };
      setBoardObjects(prev => [...prev, newObj]);
      setBoards(prev => [...prev, name]);
      setActiveBoardId(res.id);
    } catch {
      toast.error('Error al guardar el tablero');
    }
  };

  const handleRenameBoard = async (uuidKey: string, newName: string) => {
    const boardObj = boardObjects.find(b => b.id === uuidKey);
    const oldName = boardObj?.name ?? '';
    if (!newName.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    if (boards.some(b => b !== oldName && b.toLowerCase() === trimmed.toLowerCase())) {
      toast.warning(`Ya existe otro tablero llamado "${trimmed}".`);
    }

    // UUID-based cache rename (also migrate any stale legacy keys)
    renameBoardCache(uuidKey, uuidKey); // re-key UUID cache (noop if same)
    const oldLegacyId = `recruitment-${selectedProject}-${oldName}`;
    const newLegacyId = `recruitment-${selectedProject}-${trimmed}`;
    renameBoardCache(oldLegacyId, newLegacyId); // migrate stale legacy keys

    // Optimistic UI update — activeBoardId stays same (UUID doesn't change on rename)
    setBoards(prev => prev.map(b => b === oldName ? trimmed : b));
    setBoardObjects(prev => prev.map(b => b.id === uuidKey ? { ...b, name: trimmed } : b));
    setRows(prev => prev.map(r => r.boardName === oldName ? { ...r, boardName: trimmed } : r));

    // Migrate hidden columns localStorage key from legacy to new legacy
    const oldHiddenKey = getGeneralHiddenColsKey(oldLegacyId);
    const newHiddenKey = getGeneralHiddenColsKey(newLegacyId);
    const savedHidden = localStorage.getItem(oldHiddenKey);
    if (savedHidden) { localStorage.setItem(newHiddenKey, savedHidden); localStorage.removeItem(oldHiddenKey); }

    // Migrate rowsCache
    const oldCacheKey = `${selectedProject}::${oldName}`;
    const newCacheKey = `${selectedProject}::${trimmed}`;
    const cached = rowsCache.get(oldCacheKey);
    if (cached) {
      rowsCache.set(newCacheKey, cached.map(r => r.boardName === oldName ? { ...r, boardName: trimmed } : r));
      rowsCache.delete(oldCacheKey);
    }

    try {
      await renameBoard({ boardId: uuidKey, oldBoardName: oldName, newBoardName: trimmed, projectCode: selectedProject ?? '' });
      toast.success(`Tablero renombrado a "${trimmed}"`);
    } catch {
      toast.error('Error al renombrar el tablero');
      // Rollback
      renameBoardCache(newLegacyId, oldLegacyId);
      setBoards(prev => prev.map(b => b === trimmed ? oldName : b));
      setBoardObjects(prev => prev.map(b => b.id === uuidKey ? { ...b, name: oldName } : b));
      setRows(prev => prev.map(r => r.boardName === trimmed ? { ...r, boardName: oldName } : r));
      if (cached) {
        rowsCache.set(oldCacheKey, cached);
        rowsCache.delete(newCacheKey);
      }
    }
  };

  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dropColId, setDropColId] = useState<string | null>(null);
  const [colSearchText, setColSearchText] = useState('');

  if (!selectedProject) return (
    <div className="flex flex-col items-center justify-center h-full text-center p-12">
      <div className="text-4xl mb-4">👥</div>
      <h3 className="text-lg font-semibold mb-2">Selecciona un proyecto</h3>
      <p className="text-muted-foreground text-sm">Los tableros de reclutamiento están organizados por proyecto.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Board tabs */}
      <div className="flex items-center border-b border-border bg-card flex-shrink-0 overflow-hidden min-w-0">
        <BoardTabsBar
          boards={boards}
          boardObjects={boardObjects}
          activeBoard={activeBoardId}
          onActiveBoardChange={(uuid) => {
            clearAllFilters(); setFilterSearch(''); setActiveView(null); setExpandedGroups(new Set(['__none__']));
            setActiveBoardId(uuid);
            const bName = boardObjects.find(b => b.id === uuid)?.name ?? '';
            // R2-B: UUID cache key
            const cacheKey = uuid ? `${selectedProject}::uuid::${uuid}` : `${selectedProject}::${bName}`;
            const cached = rowsCache.get(cacheKey);
            if (cached) {
              setRows(cached);
              getRecruitmentRows({ projectCode: selectedProject ?? undefined, boardId: uuid || undefined, boardName: bName }).then(d => {
                rowsCache.set(cacheKey, d.rows);
                setBoardObjects((d.boardObjects ?? []).map(b => ({ id: b.id, name: b.name, boardType: b.boardType ?? 'recruitment', boardOrder: b.boardOrder ?? 0 })));
                if (JSON.stringify(d.rows) !== JSON.stringify(cached)) setRows(d.rows);
              });
            } else {
              load(bName, uuid);
            }
          }}
          adding={addingBoard}
          setAdding={setAddingBoard}
          newBoardName={newBoardName}
          setNewBoardName={setNewBoardName}
          onAddBoard={addBoard}
          onDuplicateBoard={() => {}}
          onDeleteBoard={(uuid) => {
            const name = boardObjects.find(b => b.id === uuid)?.name ?? '';
            setDeletingBoard(uuid);
            setDeletingBoardName(name);
          }}
          onReorder={reorderBoards}
          onRenameBoard={handleRenameBoard}
          addLabel="Tablero"
          inputPlaceholder="Nombre tablero"
        />
        <button
          onClick={() => setImportDialogOpen(true)}
          title="Crear tablero desde Excel"
          className="px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 border-l border-border/40 flex-shrink-0"
        >
          <Upload className="w-3 h-3" /> Importar Excel
        </button>
        {/* Dead inline tabs code removed — BoardTabsBar handles everything above */}
        {presence.members.length > 0 && (
          <div className="flex items-center px-3 pb-1 flex-shrink-0">
            <ProjectPresenceAvatars members={presence.members} />
          </div>
        )}
        {onOpenMuestra && (
          <Button
            size="sm" variant={hasMuestra ? 'default' : 'outline'}
            className="gap-1.5 h-7 text-xs ml-auto mr-3 flex-shrink-0"
            onClick={onOpenMuestra}
          >
            <ClipboardList className="w-3 h-3" />
            {hasMuestra ? 'Ver muestra' : 'Definir muestra'}
          </Button>
        )}
      </div>

      {!compactMode && (
      <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 bg-muted/30 flex-shrink-0 flex-wrap border-b border-border/40">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground flex-shrink-0" onClick={toggleCompact} title="Modo compacto">
          <ChevronsDownUp className="w-4 h-4" />
        </Button>
        <Input placeholder="Buscar..." className="w-44 h-8 text-sm" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
        <AdvancedFilterSheet
          columns={allColumns}
          rules={advancedFilters}
          onRulesChange={setAdvancedFilters}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          colUniqueValues={colUniqueValues}
          columnFilters={columnFilters}
          onClearColumnFilter={key => setColFilter(key, new Set())}
          activeFilterCount={activeFilterCount}
          activeViewName={activeView?.viewName}
          onSaveToView={hasUnsavedViewChanges ? handleSaveCurrentView : undefined}
          onClearAll={handleClearAll}
        />
        {/* Column visibility */}
        {activeBoardId && (
          <Popover onOpenChange={open => { if (!open) setColSearchText(''); }}>
            <PopoverTrigger asChild>
              <Button size="sm" variant={hiddenColumns.size > 0 ? 'default' : 'outline'} className="gap-1.5 h-8">
                {hiddenColumns.size > 0 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                Columnas
                {hiddenColumns.size > 0 && (
                  <span className="ml-0.5 bg-background/30 text-inherit text-[10px] font-semibold px-1.5 rounded-full">
                    {hiddenColumns.size} oculta{hiddenColumns.size !== 1 ? 's' : ''}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-3">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Columnas</p>
                <div className="flex items-center rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setHiddenColumns(new Set())}
                    className="px-2 py-0.5 text-[11px] font-medium text-foreground bg-card hover:bg-muted transition-colors border-r border-border"
                  >
                    Todas
                  </button>
                  <button
                    onClick={() => {
                      const allKeys = [
                        'email', 'phone', 'idNumber', 'status', 'nda',
                        '_dupBoard', '_dupHistory', '_dupRisk',
                        ...dynCols.columns.map(c => c.id),
                      ];
                      setHiddenColumns(new Set(allKeys));
                    }}
                    className="px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-card hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Ninguna
                  </button>
                </div>
              </div>
              {/* Search input */}
              <div className="relative mb-2.5">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                <Input
                  value={colSearchText}
                  onChange={e => setColSearchText(e.target.value)}
                  placeholder="Buscar columna..."
                  className="h-7 text-xs pl-6 pr-2"
                />
              </div>
              <div className="max-h-[50vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                {/* Fixed columns */}
                {[
                  { key: 'email',    label: 'Email' },
                  { key: 'phone',    label: 'Teléfono' },
                  { key: 'idNumber', label: 'ID / Doc' },
                  { key: 'status',   label: 'Estado' },
                  { key: 'nda',      label: 'NDA' },
                  { key: '_dupBoard',   label: 'Este filtro' },
                  { key: '_dupHistory', label: 'Otros formularios' },
                  { key: '_dupRisk',    label: 'Elegibilidad' },
                ].filter(col => !colSearchText.trim() || col.label.toLowerCase().includes(colSearchText.toLowerCase())).map(col => (
                  <label key={col.key} className="flex items-center gap-2.5 cursor-pointer group">
                    <Checkbox
                      checked={!hiddenColumns.has(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-sm text-foreground group-hover:text-primary transition-colors">{col.label}</span>
                  </label>
                ))}
                {/* Dynamic columns */}
                {dynCols.columns.length > 0 && (
                  <>
                    <div className="my-2 border-t border-border/40" />
                    {[...dynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0)).filter(col => !colSearchText.trim() || (col.columnName ?? '').toLowerCase().includes(colSearchText.toLowerCase())).map(col => (
                      <div
                        key={col.id}
                        draggable
                        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('colId', col.id); setDragColId(col.id); }}
                        onDragOver={e => { e.preventDefault(); setDropColId(col.id); }}
                        onDragLeave={() => { if (dropColId === col.id) setDropColId(null); }}
                        onDrop={async e => {
                          e.preventDefault();
                          const fromId = e.dataTransfer.getData('colId');
                          if (fromId && fromId !== col.id) {
                            await dynCols.reorderColumns(fromId, col.id, 'left');
                          }
                          setDragColId(null); setDropColId(null);
                        }}
                        onDragEnd={() => { setDragColId(null); setDropColId(null); }}
                        className={`flex items-center gap-1.5 py-0.5 rounded-md transition-colors cursor-grab active:cursor-grabbing ${dragColId === col.id ? 'opacity-30' : ''} ${dropColId === col.id && dragColId !== col.id ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
                      >
                        <GripVertical className="w-3 h-3 text-muted-foreground/30 hover:text-muted-foreground flex-shrink-0 transition-colors" />
                        <Checkbox
                          checked={!hiddenColumns.has(col.id)}
                          onCheckedChange={() => toggleColumn(col.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-sm text-foreground hover:text-primary transition-colors truncate flex-1">{col.columnName}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              </div>
              {hasUnsavedViewChanges && activeView && (
                <button
                  onClick={handleSaveCurrentView}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 h-8 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Save className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">Guardar en vista «{activeView.viewName}»</span>
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setDuplicateSearchOpen(true)}>
          <SearchCheck className="w-3.5 h-3.5" /> Verificar duplicado
        </Button>
        {activeBoardId && (
          <Button size="sm" variant={dynCols.linkedFormInfo ? 'default' : 'outline'} className="gap-1.5 h-8" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="w-3.5 h-3.5" />
            {dynCols.linkedFormInfo ? (
              <span className="flex items-center gap-1.5">
                <span className="max-w-[120px] truncate">{dynCols.linkedFormInfo.formName}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 flex-shrink-0" />
              </span>
            ) : 'Vincular form'}
          </Button>
        )}
        {activeBoardId && dynCols.linkedFormInfo && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2.5 h-8">
            {syncing ? (
              <><RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" /><span>Sincronizando...</span></>
            ) : lastSyncTime ? (
              <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /><span>Sync: {(() => { const diff = Math.floor((Date.now() - lastSyncTime.getTime()) / 60000); return diff < 1 ? 'ahora mismo' : `hace ${diff} min`; })()}</span></>
            ) : (
              <><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" /><span>Esperando sync...</span></>
            )}
            <button
              onClick={() => handleSync(false)}
              disabled={syncing}
              className="ml-1 p-0.5 rounded hover:bg-muted disabled:opacity-40 transition-colors"
              title="Sincronizar ahora"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        )}

        {activeBoardId && (() => {
          const currentProject = projects.find(p => p.projectCode === selectedProject);
          const hasMuestra = !!(currentProject as any)?.muestra?.trim() || !!(currentProject as any)?.muestraImagen?.trim();
          return hasMuestra ? (
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-primary border-primary/40 hover:bg-primary/10" onClick={() => setStatusPanelOpen(true)}>
              <BarChart3 className="w-3.5 h-3.5" /> Status
            </Button>
          ) : null;
        })()}
        {activeBoardId && (
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShareDialogOpen(true)}>
            <Share2 className="w-3.5 h-3.5" /> Compartir
          </Button>
        )}
        {activeBoardId && (
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setImportDialogOpen(true)}>
            <Upload className="w-3.5 h-3.5" /> Importar Excel
          </Button>
        )}
        {activeBoardId && boardRows.length > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => {
            exportRecruitmentCsv(boardRows, hiddenColumns, dynCols, groupDynCols);
            toast.success(`${boardRows.filter(r => !r.parentRowId).length} filas exportadas a CSV`);
          }}>
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        )}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
            onClick={() => setTrashOpen(true)}
            title="Papelera"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {boardRows.filter(r => !r.parentRowId).length} participantes
        </span>
      </div>

      {/* Internal Views Bar */}
      {activeBoardId && (
        <InternalViewsBar
          ref={internalViewsBarRef}
          boardId={activeBoardId}
          projectCode={selectedProject ?? ''}
          boardName={activeBoardName}
          activeViewId={activeView?.id ?? null}
          onViewSelected={handleViewSelected}
          currentFiltersJson={currentFiltersJson}
          hasUnsavedChanges={hasUnsavedViewChanges}
          onViewUpdated={handleViewUpdated}
        />
      )}
      </>
      )}
      {compactMode && (
        <div className="flex items-center gap-2 px-4 py-1 bg-muted/30 border-b border-border/40 flex-shrink-0">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground flex-shrink-0" onClick={toggleCompact} title="Expandir toolbar">
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-border/50" />
          {activeBoardId && (
            <span className="text-[11px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-md truncate max-w-[150px]">{activeBoardName}</span>
          )}
          {activeView && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Eye className="w-3 h-3" /> {activeView.viewName}
            </span>
          )}
          {totalActiveFilters > 0 && (
            <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
              {totalActiveFilters} filtro{totalActiveFilters !== 1 ? 's' : ''}
            </span>
          )}
          <Input placeholder="Buscar..." className="w-36 h-6 text-xs" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          {dynCols.linkedFormInfo && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              {syncing ? 'Sync...' : 'Fillout'}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-muted-foreground">
            {boardRows.filter(r => !r.parentRowId).length} participantes
          </span>
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 flex flex-col overflow-hidden px-6 py-4">
        {loading || (activeBoardId && !groupDynCols.hasInitiallyLoaded) ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : boardRows.length === 0 && totalActiveFilters === 0 && !activeBoardId ? (
          <div className="text-center py-12 text-muted-foreground">Crea un tablero primero.</div>
        ) : (
          <RecruitmentTable
            key={activeBoardId || 'no-board'}
            rows={boardRows}
            onSaveName={saveName}
            onSaveField={saveField}
            onEdit={openEdit}
            onDelete={setDeleting}
            onBulkDelete={ids => setBulkDeletingIds(ids)}
            onUpdateStatus={updateStatus}
            onSendNDA={sendNDA}
            onQuickCreate={quickCreate}
            onCreateGroup={createGroup}
            dynCols={dynCols}
            groupDynCols={groupDynCols}
            columnFilters={columnFilters}
            setColFilter={setColFilter}
            colUniqueValues={colUniqueValues}
            onDuplicateClick={setDuplicateHistoryRow}
            badgeMap={badgeMap}
            hiddenColumns={hiddenColumns}
            onRowsChange={setRows}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            toggleSort={toggleSort}
            onRefresh={silentReload}
            linkedEventsMap={linkedEventsMap}
            projectCode={selectedProject ?? undefined}
            recruitmentBoardId={activeBoardId}
            onLinkedEventsRefresh={() => setLinkedEventsRefreshTick(t => t + 1)}
            onCreateEventForGroup={handleCreateEventForGroup}
            expandedGroups={expandedGroups}
            setExpandedGroups={setExpandedGroups}
            activeGroupFilter={activeGroupFilter}
            onDuplicateGroup={async (groupId) => {
              try {
                const res = await duplicateGroup({ groupColumnId: groupId, tableType: 'recruitment' });
                toast.success(`Grupo duplicado con ${res.duplicatedRows} fila${res.duplicatedRows !== 1 ? 's' : ''}`);
                silentReload();
                groupDynCols.reload();
                setTimeout(publishGroupChange, 300);
              } catch { toast.error('Error al duplicar grupo'); }
            }}
            onGroupStructureChanged={publishGroupChange}
          />
        )}

        {/* Create Event Dialog */}
        {createEventDialog && selectedProject && (
          <CreateEventDialog
            open={!!createEventDialog}
            onOpenChange={o => { if (!o) setCreateEventDialog(null); }}
            projectCode={selectedProject}
            groupId={createEventDialog.groupId}
            groupName={createEventDialog.groupName}
            recruitmentBoardId={activeBoardId}
            onSuccess={() => {
              setCreateEventDialog(null);
              groupDynCols.softReload();
            }}
          />
        )}

        {boardRows.length === 0 && totalActiveFilters > 0 && (
          <div className="text-center py-8 text-muted-foreground mt-4">
            <p className="font-medium mb-2">Sin resultados con los filtros actuales</p>
            <Button size="sm" variant="outline" onClick={handleClearAll}>Limpiar filtros</Button>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar participante' : 'Agregar participante'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="col-span-2 space-y-1"><Label>Nombre completo</Label><Input value={form.participantName} onChange={e => setForm(f => ({ ...f, participantName: e.target.value, rowName: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Teléfono</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Documento</Label><Input value={form.idNumber} onChange={e => setForm(f => ({ ...f, idNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Estado</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingBoard} onOpenChange={o => { if (!o) { setDeletingBoard(null); setDeletingBoardName(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tablero "{deletingBoardName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrarán todos los participantes y columnas de este tablero. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteBoard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar tablero
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar fila?</AlertDialogTitle><AlertDialogDescription>Se eliminarán también las filas hijas.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={del} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeletingIds.length > 0} onOpenChange={o => !o && setBulkDeletingIds([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {bulkDeletingIds.length} fila{bulkDeletingIds.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán también las filas hijas de cada participante.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              const ids = [...bulkDeletingIds];
              const prev = rows;
              const idsSet = new Set(ids);
              setRows(r => r.filter(x => !idsSet.has(x.id) && !idsSet.has(x.parentRowId ?? '')));
              setBulkDeletingIds([]);
              toast.success(`${ids.length} fila${ids.length !== 1 ? 's' : ''} eliminada${ids.length !== 1 ? 's' : ''}`);
              let failed = false;
              for (const id of ids) {
                try { await deleteRecruitmentRow({ id }); } catch { failed = true; }
              }
              if (failed) {
                setRows(prev);
                silentReload();
                toast.error('Algunas filas no se pudieron eliminar');
              }
            }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      <TrashSheet
        open={trashOpen}
        onOpenChange={setTrashOpen}
        projectCode={selectedProject ?? ''}
        onRestored={() => silentReload()}
      />
      <DuplicateSearchDialog
        open={duplicateSearchOpen}
        onOpenChange={setDuplicateSearchOpen}
        projectCode={selectedProject ?? undefined}
        boardName={activeBoardName || undefined}
      />
      {activeBoardId && (
        <SharedViewDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          boardId={activeBoardId}
          projectCode={selectedProject ?? ''}
          boardName={activeBoardName}
          dynamicColumns={dynCols.columns}
          colUniqueValues={colUniqueValues}
        />
      )}
      {duplicateHistoryRow && (
        <DuplicateHistoryModal row={duplicateHistoryRow} onClose={() => setDuplicateHistoryRow(null)} currentClient={projects.find(p => p.projectCode === duplicateHistoryRow.projectCode)?.client} />
      )}
      <ExcelImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        boardId={activeBoardId || undefined}
        boardName={activeBoardName || undefined}
        projectCode={selectedProject ?? ''}
        currentClient={projects.find(p => p.projectCode === selectedProject)?.client}
        onImported={(imported, newBoard) => {
          if (newBoard) {
            setBoards(prev => prev.includes(newBoard) ? prev : [...prev, newBoard]);
            // Reload to get updated boardObjects with the new board's UUID
            load(newBoard);
            // The load() response will set boardObjects; derive activeBoardId after
            getRecruitmentRows({ projectCode: selectedProject ?? undefined, boardName: newBoard }).then(d => {
              const newObj = (d.boardObjects ?? []).find(b => b.name === newBoard);
              if (newObj) setActiveBoardId(newObj.id);
            }).catch(() => {});
          } else {
            silentReload();
            dynCols.reload();
            groupDynCols.reload();
          }
        }}
      />
      {activeBoardId && (
        <FilloutLinkDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          boardId={activeBoardId}
          projectCode={selectedProject ?? ''}
          boardName={activeBoardName}
          busyRef={busyRef}
          onLinked={() => { dynCols.reload(); }}
          onImportDone={(count) => {
            setLastSyncTime(new Date());
            if (count > 0) silentReload();
          }}
        />
      )}
      {activeBoardId && selectedProject && (
        <RecruitmentStatusPanel
          open={statusPanelOpen}
          onOpenChange={setStatusPanelOpen}
          projectCode={selectedProject}
          boardName={activeBoardName}
          projectId={(projects.find(p => p.projectCode === selectedProject) as any)?.id ?? ''}
          projectName={projects.find(p => p.projectCode === selectedProject)?.fullName}
          muestraImageUrl={(projects.find(p => p.projectCode === selectedProject) as any)?.muestraImagen ?? ''}
          initialInstruccionesDeAnalisis={(projects.find(p => p.projectCode === selectedProject) as any)?.instruccionesDeAnalisis ?? ''}

        />
      )}
    </div>
  );
}
