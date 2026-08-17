import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight, ChevronDown, CornerDownRight, ZoomIn, ZoomOut } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { saveCellValue, saveTask } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { type Task, type GanttScale, type BoardGanttGroup } from './pmTypes';
import { BOARD_GANTT_STATUS_COLORS } from './pmConstants';
import { fmtDate, fmt } from './pmDateUtils';
import { getGroupColor } from '../table/tableUtils';
import { type DynCols } from '../DynamicColumns';
import type { DynColumn } from '../../hooks/useDynamicColumns';

// ── Row height constants ─────────────────────────────────────────────────────
const PARENT_ROW_H = 52;
const CHILD_ROW_H  = 30;
const GROUP_H      = 30;

// ── Color picker ─────────────────────────────────────────────────────────────
function BoardGanttBarColorPicker({ taskId, boardId, colorColId, currentColor, recentColors, onColorChange }: {
  taskId: string; boardId: string; colorColId: string; currentColor: string;
  recentColors: string[]; onColorChange: (taskId: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localHex, setLocalHex] = useState(currentColor || '#6366f1');
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedSave = useDebouncedCallback(async (hex: string) => {
    onColorChange(taskId, hex);
    try { await saveCellValue({ boardId, rowId: taskId, columnId: colorColId, textValue: hex }); } catch { /* best-effort */ }
  }, 400);

  const applyColor = async (hex: string) => {
    setLocalHex(hex); onColorChange(taskId, hex); setOpen(false);
    try { await saveCellValue({ boardId, rowId: taskId, columnId: colorColId, textValue: hex }); } catch { /* best-effort */ }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onClick={e => { e.stopPropagation(); setOpen(true); }} title="Cambiar color" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-52" align="center" onClick={e => e.stopPropagation()}>
        <div className="p-2 border-b border-border"><p className="text-xs font-medium text-muted-foreground px-1">Color de la barra</p></div>
        <div className="p-3 space-y-3">
          {recentColors.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Recientes</p>
              <div className="flex flex-wrap gap-1.5">
                {recentColors.map(hex => (
                  <button key={hex} title={hex} onClick={() => applyColor(hex)}
                    className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${currentColor === hex ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-border/50'}`}
                    style={{ backgroundColor: hex }} />
                ))}
              </div>
            </div>
          )}
          <div>
            <input ref={inputRef} type="color" className="sr-only" value={localHex}
              onChange={e => { setLocalHex(e.target.value); debouncedSave(e.target.value); }} />
            <button onClick={() => inputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors text-left">
              <div className="w-5 h-5 rounded-full border border-border/50 flex-shrink-0" style={{ backgroundColor: localHex }} />
              <span className="text-xs text-foreground">Elegir color personalizado</span>
            </button>
          </div>
        </div>
        {currentColor && (
          <div className="px-3 pb-3">
            <button className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 rounded hover:bg-muted/50 transition-colors"
              onClick={async () => { onColorChange(taskId, ''); setOpen(false); try { await saveCellValue({ boardId, rowId: taskId, columnId: colorColId, textValue: '' }); } catch { /**/ } }}>
              Quitar color
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Row types ─────────────────────────────────────────────────────────────────
type GanttRow =
  | { kind: 'group-header'; group: BoardGanttGroup; groupColor: string }
  | { kind: 'task';         task: Task;              groupColor: string }
  | { kind: 'child';        task: Task;              groupColor: string };

const rowH   = (r: GanttRow) => r.kind === 'group-header' ? GROUP_H : r.kind === 'child' ? CHILD_ROW_H : PARENT_ROW_H;
const rowKey = (r: GanttRow) => r.kind === 'group-header' ? `g:${r.group.id}` : `t:${r.task.id}`;

// ── Main component ────────────────────────────────────────────────────────────
export function GanttView({ tasks, dynCols, childDynCols, groupDynCols, boardId }: {
  tasks: Task[]; dynCols: DynCols; childDynCols: DynCols; groupDynCols: DynCols; boardId: string;
}) {
  const [scale, setScale]               = useState<GanttScale>('weeks');
  const [colorMode, setColorMode]       = useState<'status' | 'color'>('status');
  const [localColors, setLocalColors]   = useState<Map<string, string>>(new Map());
  const [localDates, setLocalDates]     = useState<Map<string, { start: string; end: string }>>(new Map());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hoveredKey, setHoveredKey]     = useState<string | null>(null);

  const hasScrolledRef = useRef(false);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const dragRef        = useRef<{
    taskId: string; edge: 'left' | 'right'; origStart: string; origEnd: string;
    startX: number; curStart: string; curEnd: string;
  } | null>(null);
  const ppdRef        = useRef(4);
  const padMinRef     = useRef(new Date());
  const saveResizeRef = useRef<((id: string, s: string, e: string) => Promise<void>) | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    taskId: string; bLeft: number; bWidth: number; label: string; mouseX: number; mouseY: number;
  } | null>(null);

  // Mouse events for drag-resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaDays = Math.round((e.clientX - drag.startX) / ppdRef.current);
      let newStart = drag.origStart, newEnd = drag.origEnd;
      if (drag.edge === 'left') {
        const d = new Date(drag.origStart + 'T00:00:00'); d.setDate(d.getDate() + deltaDays);
        if (d < new Date(drag.origEnd + 'T00:00:00')) newStart = d.toISOString().split('T')[0];
      } else {
        const d = new Date(drag.origEnd + 'T00:00:00'); d.setDate(d.getDate() + deltaDays);
        if (d > new Date(drag.origStart + 'T00:00:00')) newEnd = d.toISOString().split('T')[0];
      }
      drag.curStart = newStart; drag.curEnd = newEnd;
      const bLeft  = Math.max(0, (new Date(newStart + 'T00:00:00').getTime() - padMinRef.current.getTime()) / 86400000 * ppdRef.current);
      const bWidth = Math.max(((new Date(newEnd + 'T00:00:00').getTime() - new Date(newStart + 'T00:00:00').getTime()) / 86400000 + 1) * ppdRef.current, 4);
      setDragPreview({ taskId: drag.taskId, bLeft, bWidth, label: drag.edge === 'left' ? fmtDate(new Date(newStart + 'T00:00:00')) : fmtDate(new Date(newEnd + 'T00:00:00')), mouseX: e.clientX, mouseY: e.clientY });
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      setDragPreview(null);
      if (drag.curStart !== drag.origStart || drag.curEnd !== drag.origEnd)
        saveResizeRef.current?.(drag.taskId, drag.curStart, drag.curEnd);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const findCol = (name: string) =>
    (dynCols.columns.find(c => c.columnName === name) ?? childDynCols.columns.find(c => c.columnName === name)) as DynColumn | undefined;
  const startCol  = findCol('Inicio');
  const endCol    = findCol('Fin');
  const statusCol = findCol('Estado');
  const colorCol  = dynCols.columns.find(c => c.columnName?.toLowerCase() === 'color');

  const getDateVal = (id: string, col?: DynColumn) =>
    col ? ((dynCols.getCellVal(id, col.id) ?? childDynCols.getCellVal(id, col.id))?.dateValue?.split('T')[0] ?? '') : '';

  const getStatus = (t: Task) => {
    if (statusCol) {
      const c = dynCols.getCellVal(t.id, statusCol.id) ?? childDynCols.getCellVal(t.id, statusCol.id);
      if (c?.textValue) return c.textValue;
    }
    return t.status ?? 'Pendiente';
  };

  const tStart = (t: Task) => localDates.get(t.id)?.start || getDateVal(t.id, startCol) || t.startDate?.split('T')[0] || '';
  const tEnd   = (t: Task) => localDates.get(t.id)?.end   || getDateVal(t.id, endCol)   || t.endDate?.split('T')[0]   || '';

  const fmtRange = (s: string, e: string) => {
    if (!s || !e) return '';
    const sd = new Date(s + 'T00:00:00'), ed = new Date(e + 'T00:00:00');
    return s === e ? fmt(sd) : `${fmt(sd)} – ${fmt(ed)}`;
  };

  const getTaskBarColor = (t: Task, fallback: string) => {
    if (colorMode === 'color') {
      const lc = localColors.get(t.id);
      if (lc !== undefined) return lc || fallback;
      const stored = colorCol ? (dynCols.getCellVal(t.id, colorCol.id)?.textValue ?? '') : '';
      return stored || fallback;
    }
    return BOARD_GANTT_STATUS_COLORS[getStatus(t)] ?? fallback;
  };

  const groups        = groupDynCols.columns;
  const getTaskGroupId = (taskId: string) =>
    groups.find(g => groupDynCols.getCellVal(taskId, g.id)?.textValue === '1')?.id ?? null;

  const topLevelWithDates = tasks.filter(t => !t.parentTaskId && tStart(t) && tEnd(t));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recentColors = useMemo(() => {
    if (!colorCol) return [];
    const seen = new Set<string>(); const result: string[] = [];
    for (const t of tasks.filter(t => !t.parentTaskId)) {
      const hex = dynCols.getCellVal(t.id, colorCol.id)?.textValue;
      if (hex && !seen.has(hex)) { seen.add(hex); result.push(hex); }
      if (result.length >= 10) break;
    }
    return result;
  }, [tasks, colorCol, dynCols.getCellVal]);

  if (topLevelWithDates.length === 0) return (
    <div className="text-center text-muted-foreground py-16">No hay tareas con fechas de inicio y fin para el Gantt.</div>
  );

  // ── Date math ─────────────────────────────────────────────────────────────
  const allDates  = topLevelWithDates.flatMap(t => [new Date(tStart(t)), new Date(tEnd(t))]);
  const minD      = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxD      = new Date(Math.max(...allDates.map(d => d.getTime())));
  const padMin    = new Date(minD.getFullYear(), 0, 1);
  const padMax    = new Date(maxD.getFullYear(), 11, 31);
  const totalDays = Math.max(Math.ceil((padMax.getTime() - padMin.getTime()) / 86400000), 1);
  const pxPerDay  = scale === 'days' ? 40 : scale === 'weeks' ? 12 : 4;
  const totalWidth = totalDays * pxPerDay;
  ppdRef.current    = pxPerDay;
  padMinRef.current = padMin;

  const getLeft = (d: string) => Math.max(0, (new Date(d).getTime() - padMin.getTime()) / 86400000 * pxPerDay);
  const getBarW = (s: string, e: string) => Math.max(((new Date(e).getTime() - new Date(s).getTime()) / 86400000 + 1) * pxPerDay, 4);

  // ── Day columns & grid lines ───────────────────────────────────────────────
  const DAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const dayCols = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(padMin); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    return { idx: i, left: i * pxPerDay, dow, isWeekend: dow === 0 || dow === 6, label: DAY_LABELS[dow], dayNum: d.getDate() };
  });
  const weekendCols = dayCols.filter(d => d.isWeekend);

  const gridLines: { label: string; left: number; isMajor: boolean }[] = [];
  {
    const cur = new Date(padMin);
    if (scale === 'days') {
      cur.setHours(0, 0, 0, 0);
      while (cur <= padMax) {
        const isMonday = cur.getDay() === 1, isFirst = cur.getDate() === 1;
        gridLines.push({ label: isFirst ? cur.toLocaleDateString('es', { day: 'numeric', month: 'short' }) : cur.getDate().toString(), left: (cur.getTime() - padMin.getTime()) / 86400000 * pxPerDay, isMajor: isMonday || isFirst });
        cur.setDate(cur.getDate() + 1);
      }
    } else if (scale === 'weeks') {
      cur.setHours(0, 0, 0, 0);
      while (cur.getDay() !== 1) cur.setDate(cur.getDate() + 1);
      while (cur <= padMax) {
        gridLines.push({ label: cur.toLocaleDateString('es', { day: 'numeric', month: 'short' }), left: (cur.getTime() - padMin.getTime()) / 86400000 * pxPerDay, isMajor: cur.getDate() <= 7 });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      const mCur = new Date(padMin.getFullYear(), padMin.getMonth(), 1);
      while (mCur <= padMax) {
        gridLines.push({ label: mCur.toLocaleDateString('es', { month: 'short', year: '2-digit' }), left: (mCur.getTime() - padMin.getTime()) / 86400000 * pxPerDay, isMajor: true });
        mCur.setMonth(mCur.getMonth() + 1);
      }
    }
  }

  const todayD    = new Date(); todayD.setHours(0, 0, 0, 0);
  const todayLeft = (todayD.getTime() - padMin.getTime()) / 86400000 * pxPerDay;
  const showToday = todayLeft > 0 && todayLeft < totalWidth;

  // ── Build groups ──────────────────────────────────────────────────────────
  const byGroup = new Map<string, Task[]>();
  byGroup.set('__none__', []);
  for (const g of groups) byGroup.set(g.id, []);
  for (const t of topLevelWithDates) {
    const gid = getTaskGroupId(t.id) ?? '__none__';
    (byGroup.get(gid) ?? byGroup.get('__none__')!).push(t);
  }
  const ganttGroups: BoardGanttGroup[] = [];
  const noneTs = byGroup.get('__none__') ?? [];
  if (noneTs.length > 0) ganttGroups.push({ id: '__none__', name: 'Sin grupo', tasks: noneTs });
  for (const g of groups) {
    const ts = byGroup.get(g.id) ?? [];
    if (ts.length > 0) ganttGroups.push({ id: g.id, name: g.columnName ?? 'Grupo', colorId: g.columnType, tasks: ts });
  }

  // ── Build flat rows array ─────────────────────────────────────────────────
  const flatRows: GanttRow[] = [];
  for (const group of ganttGroups) {
    const groupColor = getGroupColor(group.colorId);
    flatRows.push({ kind: 'group-header', group, groupColor });
    if (!collapsedGroups.has(group.id)) {
      for (const task of group.tasks) {
        flatRows.push({ kind: 'task', task, groupColor });
        tasks.filter(t => t.parentTaskId === task.id && tStart(t) && tEnd(t))
          .forEach(child => flatRows.push({ kind: 'child', task: child, groupColor }));
      }
    }
  }

  // ── Save resize ───────────────────────────────────────────────────────────
  saveResizeRef.current = async (taskId: string, newStart: string, newEnd: string) => {
    const isChild = !!tasks.find(t => t.id === taskId)?.parentTaskId;
    if (startCol && endCol) {
      const effectiveBoardId = isChild ? `${boardId}::children` : boardId;
      (isChild ? childDynCols : dynCols).setCellVal(taskId, startCol.id, { dateValue: newStart + 'T00:00:00' });
      (isChild ? childDynCols : dynCols).setCellVal(taskId, endCol.id,   { dateValue: newEnd   + 'T00:00:00' });
      try {
        await Promise.all([
          saveCellValue({ boardId: effectiveBoardId, rowId: taskId, columnId: startCol.id, dateValue: newStart + 'T00:00:00' }),
          saveCellValue({ boardId: effectiveBoardId, rowId: taskId, columnId: endCol.id,   dateValue: newEnd   + 'T00:00:00' }),
        ]);
        toast.success('Fechas actualizadas');
      } catch { toast.error('Error al guardar fechas'); }
    } else {
      setLocalDates(prev => new Map(prev).set(taskId, { start: newStart, end: newEnd }));
      try {
        await saveTask({ id: taskId, startDate: newStart, endDate: newEnd });
        toast.success('Fechas actualizadas');
      } catch {
        setLocalDates(prev => { const n = new Map(prev); n.delete(taskId); return n; });
        toast.error('Error al guardar fechas');
      }
    }
  };

  const startResize = (e: React.MouseEvent, task: Task, edge: 'left' | 'right') => {
    e.preventDefault(); e.stopPropagation();
    const s = tStart(task), en = tEnd(task);
    if (!s || !en) return;
    dragRef.current = { taskId: task.id, edge, origStart: s, origEnd: en, startX: e.clientX, curStart: s, curEnd: en };
    document.body.style.cursor = 'col-resize';
  };

  const toggleGroup = (id: string) => setCollapsedGroups(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Auto-scroll to today on first render
  if (!hasScrolledRef.current && scrollRef.current && showToday) {
    hasScrolledRef.current = true;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: Math.max(0, todayLeft - 400) }));
  }

  const headerH = scale !== 'months' ? 48 : 32;

  // ── Shared sub-components (rendered inside each timeline row) ─────────────
  const WeekendShading = () => <>{weekendCols.map(d => (
    <div key={d.idx} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: d.left, width: pxPerDay, background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, hsl(var(--muted)/0.3) 3px, hsl(var(--muted)/0.3) 5px), hsl(var(--muted)/0.7)' }} />
  ))}</>;

  const GridLinesComp = () => <>{gridLines.map((g, i) => (
    <div key={i} className={`absolute top-0 bottom-0 ${g.isMajor ? 'border-l border-border/30' : 'border-l border-border/10'}`} style={{ left: g.left }} />
  ))}</>;

  // ── LEFT column render ────────────────────────────────────────────────────
  const renderLeft = (row: GanttRow) => {
    const h = rowH(row), k = rowKey(row), isHov = hoveredKey === k;

    if (row.kind === 'group-header') {
      const collapsed = collapsedGroups.has(row.group.id);
      return (
        <div key={`l-${k}`}
          style={{ height: h, borderLeft: `3px solid ${row.groupColor}`, background: `color-mix(in srgb, ${row.groupColor} 10%, hsl(var(--card)))` }}
          className="flex items-center gap-2 px-3 border-b border-border/30 cursor-pointer select-none overflow-hidden"
          onClick={() => toggleGroup(row.group.id)}
          onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)}>
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: row.groupColor }} />
          <span className="text-xs font-semibold truncate flex-1" style={{ color: row.groupColor }}>{row.group.name}</span>
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">({row.group.tasks.length})</span>
        </div>
      );
    }

    const isChild = row.kind === 'child';
    return (
      <div key={`l-${k}`}
        style={{ height: h, ...(!isChild ? { borderLeft: `3px solid ${row.groupColor}` } : {}) }}
        className={`flex items-center border-b overflow-hidden ${isChild ? 'border-border/10' : 'border-border/20'} ${isHov ? 'bg-muted/20' : 'bg-card'}`}
        onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)}>
        {isChild ? (
          <div className="flex items-center gap-1 w-full overflow-hidden" style={{ paddingLeft: 20, paddingRight: 12 }}>
            <CornerDownRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
            <span className="truncate text-xs text-muted-foreground">{row.task.taskName}</span>
          </div>
        ) : (
          <div className="flex flex-col justify-center w-full overflow-hidden px-3 py-1">
            <span className="text-sm font-medium leading-snug line-clamp-2" title={row.task.taskName}>{row.task.taskName}</span>
            {tStart(row.task) && tEnd(row.task) && (
              <span className="text-[11px] text-muted-foreground mt-0.5">{fmtRange(tStart(row.task), tEnd(row.task))}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── TIMELINE rows render ──────────────────────────────────────────────────
  const renderTimeline = (row: GanttRow) => {
    const h = rowH(row), k = rowKey(row), isHov = hoveredKey === k;

    if (row.kind === 'group-header') {
      return (
        <div key={`tl-${k}`}
          style={{ height: h, position: 'relative', background: `color-mix(in srgb, ${row.groupColor} 5%, transparent)` }}
          className="border-b border-border/30 cursor-pointer"
          onClick={() => toggleGroup(row.group.id)}
          onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)}>
          <WeekendShading /><GridLinesComp />
        </div>
      );
    }

    const task = row.task, isChild = row.kind === 'child';
    const s = tStart(task), e = tEnd(task);
    const barColor      = getTaskBarColor(task, row.groupColor);
    const isDragging    = dragPreview?.taskId === task.id;
    const finalLeft     = isDragging ? dragPreview!.bLeft  : (s ? getLeft(s) : 0);
    const finalWidth    = isDragging ? dragPreview!.bWidth : (s && e ? getBarW(s, e) : 0);
    const currentColor  = localColors.has(task.id) ? (localColors.get(task.id) ?? '') : (colorCol ? (dynCols.getCellVal(task.id, colorCol.id)?.textValue ?? '') : '');

    return (
      <div key={`tl-${k}`}
        style={{ height: h, position: 'relative' }}
        className={`border-b ${isChild ? 'border-border/10' : 'border-border/20'} ${isHov ? 'bg-muted/20' : ''}`}
        onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)}>
        <WeekendShading />
        <GridLinesComp />
        {s && e && (
          <div className={`absolute ${isChild ? 'top-1 h-5 rounded shadow-sm' : 'top-1.5 h-6 rounded-md shadow-sm'}`}
            style={{ left: finalLeft, width: finalWidth, backgroundColor: barColor, border: `${isChild ? 1 : 1.5}px solid ${barColor}`, userSelect: 'none' }}>
            {/* Left resize */}
            <div className="absolute left-0 top-0 bottom-0 w-3 z-20 cursor-col-resize flex items-center justify-center rounded-l-sm hover:bg-white/20 transition-colors"
              onMouseDown={ev => startResize(ev, task, 'left')}>
              <div className={`w-px ${isChild ? 'h-2.5' : 'h-3'} bg-white/60 rounded-full`} />
            </div>
            {/* Label */}
            <div className="absolute inset-0 flex items-center overflow-hidden pl-3 pr-3 pointer-events-none">
              {!isChild && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-1" style={{ background: BOARD_GANTT_STATUS_COLORS[getStatus(task)] ?? '#94a3b8' }} />}
              {finalWidth > (isChild ? 60 : 72) && (
                <span className={`text-[10px] text-white truncate leading-none drop-shadow-sm ${!isChild ? 'font-semibold' : ''}`}>{task.taskName}</span>
              )}
            </div>
            {/* Color picker */}
            {colorMode === 'color' && colorCol && !isChild && (
              <BoardGanttBarColorPicker taskId={task.id} boardId={boardId} colorColId={colorCol.id} currentColor={currentColor} recentColors={recentColors} onColorChange={(id, c) => setLocalColors(p => new Map(p).set(id, c))} />
            )}
            {/* Right resize */}
            <div className="absolute right-0 top-0 bottom-0 w-3 z-20 cursor-col-resize flex items-center justify-center rounded-r-sm hover:bg-white/20 transition-colors"
              onMouseDown={ev => startResize(ev, task, 'right')}>
              <div className={`w-px ${isChild ? 'h-2.5' : 'h-3'} bg-white/60 rounded-full`} />
            </div>
          </div>
        )}
        {showToday && <div className="absolute top-0 bottom-0 w-0.5 bg-destructive/60 z-10 pointer-events-none" style={{ left: todayLeft }} />}
      </div>
    );
  };

  // ── RIGHT column render ───────────────────────────────────────────────────
  const renderRight = (row: GanttRow) => {
    const h = rowH(row), k = rowKey(row), isHov = hoveredKey === k;

    if (row.kind === 'group-header') {
      return (
        <div key={`r-${k}`}
          style={{ height: h, background: `color-mix(in srgb, ${row.groupColor} 10%, hsl(var(--card)))` }}
          className="border-b border-border/30" />
      );
    }

    if (row.kind === 'task') {
      const status = getStatus(row.task), color = BOARD_GANTT_STATUS_COLORS[status] ?? '#94a3b8';
      return (
        <div key={`r-${k}`}
          style={{ height: h }}
          className={`flex items-center px-2 border-b border-border/20 ${isHov ? 'bg-muted/20' : 'bg-card'}`}
          onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)}>
          <span className="text-xs px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: color + '20', color }}>{status}</span>
        </div>
      );
    }

    // child
    return (
      <div key={`r-${k}`}
        style={{ height: h }}
        className={`border-b border-border/10 ${isHov ? 'bg-muted/10' : 'bg-card'}`}
        onMouseEnter={() => setHoveredKey(k)} onMouseLeave={() => setHoveredKey(null)} />
    );
  };

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Escala:</span>
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40">
            {([{ key: 'days', label: 'Días' }, { key: 'weeks', label: 'Semanas' }, { key: 'months', label: 'Meses' }] as const).map(opt => (
              <button key={opt.key} onClick={() => setScale(opt.key)}
                className={`px-3 py-1 text-xs rounded-md transition-all ${scale === opt.key ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(s => s === 'months' ? 'weeks' : 'days')} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors" title="Acercar"><ZoomIn className="w-4 h-4" /></button>
            <button onClick={() => setScale(s => s === 'days' ? 'weeks' : 'months')} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors" title="Alejar"><ZoomOut className="w-4 h-4" /></button>
          </div>
          {showToday && (
            <button onClick={() => scrollRef.current?.scrollTo({ left: Math.max(0, todayLeft - 300), behavior: 'smooth' })} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors">
              📍 Hoy
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <button className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${colorMode === 'status' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setColorMode('status')}>Estado</button>
            <button className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${colorMode === 'color'  ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setColorMode('color')}>Color</button>
          </div>
          {colorMode === 'color' && colorCol && <span className="text-xs text-muted-foreground italic">Click en barra para cambiar color</span>}
          {colorMode === 'status' && (
            <div className="hidden sm:flex items-center gap-3">
              {Object.entries(BOARD_GANTT_STATUS_COLORS).map(([s, c]) => (
                <div key={s} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                  <span className="text-[10px] text-muted-foreground">{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Board — 3 separate zones, only the middle scrolls horizontally */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="flex">

          {/* ── LEFT: task names — never moves horizontally ── */}
          <div className="w-52 flex-shrink-0 bg-card border-r border-border" style={{ zIndex: 30 }}>
            <div style={{ height: headerH }} className="flex items-center px-3 border-b border-border bg-muted/50 text-xs font-semibold">
              Tarea
            </div>
            {flatRows.map(renderLeft)}
          </div>

          {/* ── MIDDLE: timeline — only this section scrolls horizontally ── */}
          <div ref={scrollRef} className="flex-1 overflow-x-auto">
            <div style={{ width: totalWidth }}>
              {/* Timeline header */}
              <div style={{ height: headerH, position: 'relative' }} className="border-b border-border bg-muted/50">
                <WeekendShading />
                {gridLines.map((g, i) => (
                  <span key={i}
                    className={`absolute text-xs whitespace-nowrap ${scale !== 'months' ? 'top-1' : 'top-1/2 -translate-y-1/2'} ${g.isMajor ? 'text-foreground/70 font-medium' : 'text-muted-foreground/50'}`}
                    style={{ left: g.left + 4 }}>
                    {g.label}
                  </span>
                ))}
                {scale !== 'months' && dayCols.map(d => (
                  <div key={d.idx} className="absolute bottom-0 flex flex-col items-center justify-center overflow-hidden"
                    style={{ left: d.left, width: pxPerDay, height: scale === 'days' ? 22 : 14 }}>
                    {scale === 'days' ? (
                      <>
                        <span className={`text-[9px] font-medium leading-none ${d.isWeekend ? 'text-destructive/60' : 'text-muted-foreground/50'}`}>{d.label}</span>
                        <span className={`text-[9px] leading-none mt-0.5 ${d.isWeekend ? 'text-destructive/60' : 'text-muted-foreground/50'}`}>{d.dayNum}</span>
                      </>
                    ) : (
                      <span className={`text-[9px] leading-none ${d.isWeekend ? 'text-destructive/60' : 'text-muted-foreground/50'}`}>{d.dayNum}</span>
                    )}
                  </div>
                ))}
              </div>
              {/* Timeline rows */}
              {flatRows.map(renderTimeline)}
            </div>
          </div>

          {/* ── RIGHT: status badges — never moves horizontally ── */}
          <div className="w-24 flex-shrink-0 bg-card border-l border-border" style={{ zIndex: 30 }}>
            <div style={{ height: headerH }} className="flex items-center px-2 border-b border-border bg-muted/50 text-xs font-semibold">
              Estado
            </div>
            {flatRows.map(renderRight)}
          </div>

        </div>
      </div>

      {/* Drag preview tooltip */}
      {dragPreview && (
        <div className="fixed z-[300] bg-foreground text-background text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xl pointer-events-none"
          style={{ left: dragPreview.mouseX + 14, top: dragPreview.mouseY - 10 }}>
          {dragPreview.label}
        </div>
      )}
    </div>
  );
}
