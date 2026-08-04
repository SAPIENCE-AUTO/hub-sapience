import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { getTasksForGantt, saveCellValue, saveTask, GetTasksForGanttOutputType } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ZoomIn, ZoomOut, RotateCcw, ChevronRight, ChevronDown, Navigation, CalendarDays, CalendarX2, X, Plus, ChevronsDownUp, ChevronsUpDown, Filter } from 'lucide-react';
import { format, differenceInDays, startOfMonth, addMonths, addDays, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { useDebouncedCallback } from 'use-debounce';
import { getGroupColor } from './table/tableUtils';

type Task = GetTasksForGanttOutputType['tasks'][0];

// ── Module-level cache (survives navigation / remounts) ────────────────────────
let tasksCache: Task[] | null = null;
let projectStatusesCache: Record<string, string> = {};

const STATUS_OPTIONS = [
  { label: 'Todos',      value: 'Todos' },
  { label: 'Activos',    value: 'Activos' },
  { label: 'Finalizados', value: 'Finalizados' },
  { label: 'Cancelados', value: 'Cancelados' },
] as const;
type StatusFilter = typeof STATUS_OPTIONS[number]['value'];

const SIDEBAR_W = 260;
const ROW_H     = 32;
const GROUP_H   = 34;
const SUBGROUP_H = 30;
const MONTH_H   = 22;
const HEADER_H  = 64;
const MIN_PPD   = 5;
const MAX_PPD   = 160;
const DAY_LABELS = ['D', 'L', 'M', 'Mi', 'J', 'V', 'S'];

const STATUS_COLOR: Record<string, string> = {
  'Finalizado': '#22c55e',
  'En curso':   '#60a5fa',
  'Pendiente':  '#f59e0b',
  'Por hacer':  '#94a3b8',
  'Cancelado':  '#ef4444',
  'Stand by':   '#94a3b8',
};

const PALETTE = [
  '#4f7ef8', '#22c55e', '#f97316', '#a855f7',
  '#ef4444', '#06b6d4', '#eab308', '#ec4899',
  '#14b8a6', '#8b5cf6', '#64748b', '#f43f5e',
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    }),
  ]);
}

function pd(s: string) { return new Date(s + 'T00:00:00'); }

function fmtDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}

function pastelBg(color: string): string {
  return `color-mix(in srgb, ${color} 6%, transparent)`;
}

interface TooltipData { task: Task; x: number; y: number }

// ── Drag-resize state ──────────────────────────────────────────────────────────
interface DragState {
  taskId: string;
  edge: 'left' | 'right';
  origStart: string;
  origEnd: string;
  startX: number;
  boardId: string;
  startColId?: string;
  endColId?: string;
  curStart: string;
  curEnd: string;
}

interface DragPreview {
  taskId: string;
  bLeft: number;
  bWidth: number;
  label: string;
  mouseX: number;
  mouseY: number;
}

// ── Holiday popover ────────────────────────────────────────────────────────────
function HolidayPopover({ holidays, onAdd, onRemove }: {
  holidays: Set<string>; onAdd: (d: string) => void; onRemove: (d: string) => void;
}) {
  const [input, setInput] = useState('');
  const count = holidays.size;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs relative">
          <CalendarDays className="w-3 h-3" />
          Festivos
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <p className="text-sm font-semibold mb-3">Días festivos</p>
        <div className="flex gap-2 mb-3">
          <input
            type="date" value={input} onChange={e => setInput(e.target.value)}
            className="flex-1 text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="sm" className="h-8 px-3" onClick={() => { if (input) { onAdd(input); setInput(''); } }}>
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">Sin festivos configurados</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...holidays].sort().map(d => (
              <div key={d} className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-foreground capitalize">
                  {new Date(d + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(d)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function GanttTooltip({ data }: { data: TooltipData }) {
  const { task, x, y } = data;
  const fmt = (s?: string) => s ? fmtDate(pd(s)) : '—';
  return (
    <div className="fixed z-[200] bg-card border border-border rounded-xl shadow-2xl p-3.5 pointer-events-none w-56"
      style={{ left: x, top: y - 12, transform: 'translate(-50%, -100%)' }}>
      <p className="font-semibold text-sm text-foreground mb-2 leading-tight">{task.taskName || '(sin nombre)'}</p>
      <div className="space-y-1.5 text-xs text-muted-foreground">
        {task.status && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[task.status] ?? '#94a3b8' }} />
            <span>{task.status}</span>
          </div>
        )}
        {task.groupName && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getGroupColor(task.groupColorId) }} />
            <span>{task.groupName}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5"><span className="text-muted-foreground/60">Inicio</span><span>{fmt(task.startDate)}</span></div>
        <div className="flex items-center gap-1.5"><span className="text-muted-foreground/60">Fin</span><span>{fmt(task.endDate)}</span></div>
        {task.assignedTo && (
          <div className="flex items-center gap-1.5"><span className="text-muted-foreground/60">Asignado a</span><span className="truncate">{task.assignedTo}</span></div>
        )}
      </div>
    </div>
  );
}

// ── Drag tooltip ───────────────────────────────────────────────────────────────
function DragTooltip({ preview }: { preview: DragPreview }) {
  return (
    <div
      className="fixed z-[300] bg-foreground text-background text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xl pointer-events-none"
      style={{ left: preview.mouseX + 14, top: preview.mouseY - 10 }}
    >
      {preview.label}
    </div>
  );
}

// ── Color picker popover for bar ────────────────────────────────────────────────
function BarColorPicker({ task, recentColors, onColorChange }: {
  task: Task;
  recentColors: string[];
  onColorChange: (taskId: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localHex, setLocalHex] = useState(task.taskColor || '#6366f1');
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedSave = useDebouncedCallback(async (hex: string) => {
    if (!task.boardId || !task.colorColumnId) return;
    onColorChange(task.id, hex);
    try { await saveCellValue({ boardId: task.boardId, rowId: task.id, columnId: task.colorColumnId, textValue: hex }); }
    catch { /* best-effort */ }
  }, 400);

  const applyColor = async (hex: string) => {
    if (!task.boardId || !task.colorColumnId) return;
    setLocalHex(hex);
    onColorChange(task.id, hex);
    setOpen(false);
    try { await saveCellValue({ boardId: task.boardId, rowId: task.id, columnId: task.colorColumnId, textValue: hex }); }
    catch { /* best-effort */ }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onClick={e => { e.stopPropagation(); setOpen(true); }}
          title="Cambiar color"
        />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-52" align="center" onClick={e => e.stopPropagation()}>
        <div className="p-2 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground px-1">Color de la barra</p>
        </div>
        <div className="p-3 space-y-3">
          {recentColors.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Recientes</p>
              <div className="flex flex-wrap gap-1.5">
                {recentColors.map(hex => (
                  <button
                    key={hex}
                    title={hex}
                    onClick={() => applyColor(hex)}
                    className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${task.taskColor === hex ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-border/50'}`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <input
              ref={inputRef}
              type="color"
              className="sr-only"
              value={localHex}
              onChange={e => { setLocalHex(e.target.value); debouncedSave(e.target.value); }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors text-left"
            >
              <div className="w-5 h-5 rounded-full border border-border/50 flex-shrink-0" style={{ backgroundColor: localHex }} />
              <span className="text-xs text-foreground">Elegir color personalizado</span>
            </button>
          </div>
        </div>
        {task.taskColor && (
          <div className="px-3 pb-3">
            <button
              className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 rounded hover:bg-muted/50 transition-colors"
              onClick={async () => {
                if (!task.boardId || !task.colorColumnId) return;
                onColorChange(task.id, '');
                setOpen(false);
                try { await saveCellValue({ boardId: task.boardId, rowId: task.id, columnId: task.colorColumnId, textValue: '' }); }
                catch { /* best-effort */ }
              }}
            >Quitar color</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Grouped structure ─────────────────────────────────────────────────────────
interface SubGroup { key: string; label: string; colorId?: string; tasks: Task[]; }
interface ProjectGroup { projectCode: string; subgroups: SubGroup[]; }

// ── Main component ─────────────────────────────────────────────────────────────
export function GanttTimeline() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLoaded = useRef(false);
  const [tasks, setTasks] = useState<Task[]>(() => tasksCache ?? []);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, string>>(projectStatusesCache);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Activos');
  const [loading, setLoading] = useState(!tasksCache);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set());
  const [localColors, setLocalColors] = useState<Map<string, string>>(new Map());
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('gantt-zoom') ?? '3.5'); return isFinite(v) && v > 0 ? v : 3.5; }
    catch { return 3.5; }
  });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [showWeekendShading, setShowWeekendShading] = useState(true);
  const [colorMode, setColorMode] = useState<'status' | 'color'>('status');
  const [holidays, setHolidays] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('gantt-holidays') ?? '[]')); }
    catch { return new Set(); }
  });

  // ── Drag resize state ────────────────────────────────────────────────────────
  const dragRef      = useRef<DragState | null>(null);
  const ppdRef       = useRef(0);
  const minDateRef   = useRef(new Date());
  const justDragged  = useRef(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    console.log('[GanttTimeline] starting getTasksForGantt');
    setLoadError(null);
    setLoading(true);
    withTimeout(getTasksForGantt({}), 30000, 'getTasksForGantt')
      .then(d => {
        if (cancelled) return;
        console.log('[GanttTimeline] getTasksForGantt success', {
          tasks: d?.tasks?.length,
          projectStatuses: d?.projectStatuses ? Object.keys(d.projectStatuses).length : 0,
        });
        tasksCache = d.tasks;
        projectStatusesCache = d.projectStatuses;
        setTasks(d.tasks);
        setProjectStatuses(d.projectStatuses);
      })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GanttTimeline] Error loading tasks:', err);
        setLoadError(message);
        toast.error('Error al cargar el timeline general');
      })
      .finally(() => {
        if (cancelled) return;
        console.log('[GanttTimeline] getTasksForGantt finished');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Polling: silent refresh every 45s ─────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await withTimeout(getTasksForGantt({}), 30000, 'getTasksForGantt polling');
        if (JSON.stringify(d.tasks) !== JSON.stringify(tasksCache)) {
          tasksCache = d.tasks;
          projectStatusesCache = d.projectStatuses;
          setTasks(d.tasks);
          setProjectStatuses(d.projectStatuses);
        }
      } catch (err) {
        console.warn('[GanttTimeline] polling failed:', err);
      }
    }, 300_000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => { localStorage.setItem('gantt-zoom', String(zoom)); }, [zoom]);

  const addHoliday = (d: string) => setHolidays(prev => {
    const next = new Set(prev); next.add(d);
    localStorage.setItem('gantt-holidays', JSON.stringify([...next]));
    return next;
  });
  const removeHoliday = (d: string) => setHolidays(prev => {
    const next = new Set(prev); next.delete(d);
    localStorage.setItem('gantt-holidays', JSON.stringify([...next]));
    return next;
  });

  const handleColorChange = (taskId: string, color: string) => {
    setLocalColors(prev => new Map(prev).set(taskId, color));
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, taskColor: color || undefined } : t));
  };

  const ACTIVE_STATUSES = new Set(['En curso', 'Prospecto', 'Stand by']);

  const validTasks = useMemo(() =>
    tasks.filter(t => {
      if (!t.startDate || !t.endDate || t.startDate > t.endDate) return false;
      if (statusFilter === 'Todos') return true;
      const projStatus = t.projectCode ? (projectStatuses[t.projectCode] ?? '') : '';
      if (statusFilter === 'Activos')     return ACTIVE_STATUSES.has(projStatus);
      if (statusFilter === 'Finalizados') return projStatus === 'Finalizado';
      if (statusFilter === 'Cancelados')  return projStatus === 'Cancelado';
      return true;
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tasks, statusFilter, projectStatuses]);

  const recentColors = useMemo(() => {
    const seen = new Set<string>(); const result: string[] = [];
    for (const t of validTasks) {
      const hex = localColors.get(t.id) ?? t.taskColor;
      if (hex && !seen.has(hex)) { seen.add(hex); result.push(hex); }
      if (result.length >= 10) break;
    }
    return result;
  }, [validTasks, localColors]);

  const projectGroups = useMemo((): ProjectGroup[] => {
    const projectMap = new Map<string, Map<string, SubGroup>>();
    for (const t of validTasks) {
      const proj = t.projectCode ?? '(Sin proyecto)';
      if (!projectMap.has(proj)) projectMap.set(proj, new Map());
      const subMap = projectMap.get(proj)!;
      const sgKey = t.groupName ?? '__none__';
      if (!subMap.has(sgKey)) subMap.set(sgKey, { key: sgKey, label: t.groupName ?? 'Sin grupo', colorId: t.groupColorId, tasks: [] });
      subMap.get(sgKey)!.tasks.push(t);
    }
    const result: ProjectGroup[] = [];
    for (const [projectCode, subMap] of projectMap) {
      const subgroups = [...subMap.values()];
      subgroups.sort((a, b) => {
        if (a.key === '__none__') return -1; if (b.key === '__none__') return 1;
        return (a.tasks[0]?.startDate ?? '').localeCompare(b.tasks[0]?.startDate ?? '');
      });
      for (const sg of subgroups) sg.tasks.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
      result.push({ projectCode, subgroups });
    }
    result.sort((a, b) => {
      const aS = a.subgroups[0]?.tasks[0]?.startDate ?? '';
      const bS = b.subgroups[0]?.tasks[0]?.startDate ?? '';
      return aS.localeCompare(bS);
    });
    return result;
  }, [validTasks]);

  const { minDate, totalDays } = useMemo(() => {
    if (!validTasks.length) {
      const n = new Date(); n.setDate(n.getDate() - 15);
      return { minDate: n, totalDays: 60 };
    }
    const starts = validTasks.map(t => pd(t.startDate!).getTime());
    const ends   = validTasks.map(t => pd(t.endDate!).getTime());
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    min.setDate(min.getDate() - 14);
    max.setDate(max.getDate() + 14);
    return { minDate: min, totalDays: Math.max(60, differenceInDays(max, min) + 1) };
  }, [validTasks]);

  const basePPD = useMemo(() => Math.max(MIN_PPD, Math.min(28, 860 / totalDays)), [totalDays]);
  const ppd = Math.min(MAX_PPD, Math.max(MIN_PPD, basePPD * zoom));
  const totalWidth  = totalDays * ppd;
  const todayOff    = differenceInDays(new Date(), minDate) * ppd;
  const showDayText = ppd > 16;
  const todayStr    = format(new Date(), 'yyyy-MM-dd');

  // Keep refs in sync with derived values (for stale-closure-safe drag handlers)
  useEffect(() => { ppdRef.current = ppd; }, [ppd]);
  useEffect(() => { minDateRef.current = minDate; }, [minDate]);

  // ── Document-level drag handlers (registered once) ────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      const curPpd = ppdRef.current;
      const curMin = minDateRef.current;
      const dx = e.clientX - dr.startX;
      const deltaDays = Math.round(dx / curPpd);

      let newStart = dr.origStart;
      let newEnd   = dr.origEnd;

      if (dr.edge === 'left') {
        const raw = addDays(pd(dr.origStart), deltaDays);
        const clamped = raw >= pd(dr.origEnd) ? addDays(pd(dr.origEnd), -1) : raw;
        newStart = format(clamped, 'yyyy-MM-dd');
      } else {
        const raw = addDays(pd(dr.origEnd), deltaDays);
        const clamped = raw <= pd(dr.origStart) ? addDays(pd(dr.origStart), 1) : raw;
        newEnd = format(clamped, 'yyyy-MM-dd');
      }

      dr.curStart = newStart;
      dr.curEnd   = newEnd;

      const bLeft  = differenceInDays(pd(newStart), curMin) * curPpd;
      const bWidth = Math.max(curPpd, (differenceInDays(pd(newEnd), pd(newStart)) + 1) * curPpd);
      const label = dr.edge === 'left' ? fmtDate(pd(newStart)) : fmtDate(pd(newEnd));

      setDragPreview({ taskId: dr.taskId, bLeft, bWidth, label, mouseX: e.clientX, mouseY: e.clientY });
    };

    const onMouseUp = async () => {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      setDragPreview(null);
      document.body.style.cursor = '';

      const { taskId, boardId, startColId, endColId, curStart, curEnd, origStart, origEnd } = dr;
      if (curStart === origStart && curEnd === origEnd) return;

      // Prevent the bar's onClick from firing a navigation right after drag
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 300);

      // Optimistically update UI
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, startDate: curStart, endDate: curEnd } : t));

      // Persist to backend
      try {
        if (startColId) {
          await saveCellValue({ boardId, rowId: taskId, columnId: startColId, dateValue: curStart + 'T00:00:00' });
        } else {
          await saveTask({ id: taskId, startDate: curStart });
        }
        if (endColId) {
          await saveCellValue({ boardId, rowId: taskId, columnId: endColId, dateValue: curEnd + 'T00:00:00' });
        } else {
          await saveTask({ id: taskId, endDate: curEnd });
        }
      } catch { /* best-effort — local state already updated */ }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startResize = (e: React.MouseEvent, task: Task, edge: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    if (!task.boardId || !task.startDate || !task.endDate) return;
    document.body.style.cursor = 'col-resize';
    dragRef.current = {
      taskId: task.id,
      edge,
      origStart: task.startDate,
      origEnd:   task.endDate,
      startX:    e.clientX,
      boardId:   task.boardId,
      startColId: task.startColumnId,
      endColId:   task.endColumnId,
      curStart:  task.startDate,
      curEnd:    task.endDate,
    };
  };

  const days = useMemo(() => {
    const result: { idx: number; dow: number; isWeekend: boolean; isHoliday: boolean; dayNum: number; label: string; left: number; dateStr: string }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(minDate, i);
      const dow = getDay(date);
      const dateStr = format(date, 'yyyy-MM-dd');
      result.push({ idx: i, dow, isWeekend: dow === 0 || dow === 6, isHoliday: holidays.has(dateStr), dayNum: date.getDate(), label: DAY_LABELS[dow], left: i * ppd, dateStr });
    }
    return result;
  }, [minDate, totalDays, ppd, holidays]);

  const months = useMemo(() => {
    const segs: { label: string; left: number; width: number; odd: boolean }[] = [];
    let cur = startOfMonth(minDate);
    const endMs = minDate.getTime() + totalDays * 86400000;
    let idx = 0;
    while (cur.getTime() <= endMs) {
      const next = addMonths(cur, 1);
      const left = Math.max(0, differenceInDays(cur, minDate)) * ppd;
      const w = differenceInDays(next, cur) * ppd;
      segs.push({ label: format(cur, 'MMM yyyy', { locale: es }), left, width: w, odd: idx % 2 === 1 });
      cur = next; idx++;
    }
    return segs;
  }, [minDate, totalDays, ppd]);

  const shadedDays = useMemo(() => days.filter(d => (showWeekendShading && d.isWeekend) || d.isHoliday), [days, showWeekendShading]);

  useEffect(() => {
    if (!loading && scrollRef.current && todayOff > 0) {
      scrollRef.current.scrollLeft = Math.max(0, todayOff - (scrollRef.current.clientWidth - SIDEBAR_W) / 2);
      hasLoaded.current = true;
    }
  }, [loading]); // eslint-disable-line

  useEffect(() => {
    if (hasLoaded.current && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayOff - (scrollRef.current.clientWidth - SIDEBAR_W) / 2);
    }
  }, [ppd]); // eslint-disable-line

  const toggleProject  = (k: string) => setCollapsedProjects(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSubgroup = (k: string) => setCollapsedSubgroups(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const scrollToToday  = () => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayOff - (scrollRef.current.clientWidth - SIDEBAR_W) / 2);
  };

  const getBarColor = (task: Task, fallbackColor: string) => {
    const effectiveColor = localColors.get(task.id) ?? task.taskColor;
    if (colorMode === 'color') return effectiveColor || fallbackColor;
    return STATUS_COLOR[task.status ?? ''] || fallbackColor;
  };

  if (loading) return (
    <div className="space-y-2 py-2">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>
  );

  if (loadError) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="font-semibold text-destructive">Error al cargar el timeline general</p>
      <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
        Reintentar
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ── Row 1: Filter pills ── */}
      <div className="flex items-center gap-1.5">
        <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
          {STATUS_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${statusFilter === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setStatusFilter(value)}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── Row 2: Gantt controls ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left side */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
            onClick={() => {
              if (collapsedProjects.size === 0 && collapsedSubgroups.size === 0) {
                setCollapsedProjects(new Set(projectGroups.map(pg => pg.projectCode)));
              } else {
                setCollapsedProjects(new Set());
                setCollapsedSubgroups(new Set());
              }
            }}>
            {collapsedProjects.size === 0 && collapsedSubgroups.size === 0
              ? <><ChevronsDownUp className="w-3.5 h-3.5" /> Contraer</>
              : <><ChevronsUpDown className="w-3.5 h-3.5" /> Expandir</>}
          </Button>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <button
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${colorMode === 'status' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setColorMode('status')}
            >Status</button>
            <button
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${colorMode === 'color' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setColorMode('color')}
            >Color</button>
          </div>
          {colorMode === 'status' && (
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(STATUS_COLOR).map(([s, c]) => (
                <div key={s} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                  <span className="text-xs text-muted-foreground">{s}</span>
                </div>
              ))}
            </div>
          )}
          {colorMode === 'color' && (
            <span className="text-xs text-muted-foreground italic">Click en una barra para cambiar su color</span>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Switch id="weekend-toggle" checked={showWeekendShading} onCheckedChange={setShowWeekendShading} />
            <Label htmlFor="weekend-toggle" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">Fines de semana</Label>
          </div>
          <HolidayPopover holidays={holidays} onAdd={addHoliday} onRemove={removeHoliday} />
          <div className="w-px h-5 bg-border" />
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={scrollToToday}>
            <Navigation className="w-3 h-3" /> Hoy
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.1, z / 1.6))} disabled={ppd <= MIN_PPD}>
            <ZoomOut className="w-3 h-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(12, z * 1.6))} disabled={ppd >= MAX_PPD}>
            <ZoomIn className="w-3 h-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(3.5)} title="Reset zoom">
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!validTasks.length && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground border border-border/40 rounded-xl bg-card">
          <CalendarX2 className="w-12 h-12 text-muted-foreground/40 mb-3" strokeWidth={1.5} />
          <p className="font-semibold text-base mb-1">No hay tasks con fechas</p>
          <p className="text-sm">
            {statusFilter !== 'Todos'
              ? `No hay tasks para proyectos "${statusFilter}". Prueba cambiando el filtro.`
              : 'Agrega fechas de inicio y fin a los tasks para verlos aquí'}
          </p>
        </div>
      )}

      {/* ── Gantt board ── */}
      {validTasks.length > 0 && (
      <div className="border border-border/60 rounded-xl overflow-hidden bg-card shadow-sm">
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: 620 }}>
          <div style={{ minWidth: SIDEBAR_W + totalWidth + 1, position: 'relative' }}>

            {/* ── Header ── */}
            <div className="sticky top-0 z-30 bg-card border-b border-border/50" style={{ height: HEADER_H }}>
              <div className="flex" style={{ height: '100%' }}>
                <div className="flex-shrink-0 sticky left-0 z-40 flex items-end pb-2 px-4 border-r border-border/40 bg-card" style={{ width: SIDEBAR_W }}>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Proyecto / Grupo / Task</span>
                </div>
                <div className="relative" style={{ width: totalWidth, height: '100%', overflow: 'hidden' }}>
                  {months.map((m, i) => (
                    <div key={i} className="absolute border-r border-border/20"
                      style={{ left: m.left, width: m.width, top: 0, height: MONTH_H, overflow: 'hidden', background: m.odd ? 'hsl(var(--muted)/0.35)' : 'transparent' }}>
                      <span className="absolute bottom-1 left-2 text-[10px] font-semibold text-muted-foreground whitespace-nowrap capitalize">{m.label}</span>
                    </div>
                  ))}
                  {days.map(day => {
                    const shade = (showWeekendShading && day.isWeekend) || day.isHoliday;
                    const isToday = day.dateStr === todayStr;
                    return (
                      <div key={day.idx} className="absolute"
                        style={{ left: day.left, width: ppd, top: MONTH_H, height: HEADER_H - MONTH_H, borderRight: '1px solid hsl(var(--border)/0.1)', background: shade ? 'hsl(var(--muted)/0.4)' : 'transparent', overflow: 'hidden' }}>
                        {showDayText && (
                          <>
                            <div className={`text-center leading-none pt-1 text-[8px] ${shade ? 'text-muted-foreground/40' : 'text-muted-foreground/45'}`}>{day.label}</div>
                            <div className={`text-center leading-none mt-1 text-[9px] font-medium ${isToday ? 'text-destructive font-bold' : shade ? 'text-muted-foreground/50' : 'text-muted-foreground/75'}`}>{day.dayNum}</div>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {todayOff >= 0 && todayOff <= totalWidth && (
                    <div className="absolute z-10 pointer-events-none" style={{ left: todayOff, top: 0, bottom: 0, width: 1.5, background: 'hsl(var(--destructive)/0.85)' }} />
                  )}
                </div>
              </div>
            </div>

            {/* ── Body ── */}
            <div className="relative">
              {shadedDays.map(day => (
                <div key={day.idx} className="absolute top-0 bottom-0 pointer-events-none z-0"
                  style={{ left: SIDEBAR_W + day.left, width: ppd, background: 'hsl(var(--muted)/0.2)' }} />
              ))}
              {todayOff >= 0 && todayOff <= totalWidth && (
                <div className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: SIDEBAR_W + todayOff, width: 1.5, background: 'hsl(var(--destructive)/0.2)' }} />
              )}

              {projectGroups.map((pg, gi) => {
                const projectColor = PALETTE[gi % PALETTE.length];
                const isCollapsed = collapsedProjects.has(pg.projectCode);
                const totalTaskCount = pg.subgroups.reduce((s, sg) => s + sg.tasks.length, 0);

                return (
                  <div key={pg.projectCode} style={{ borderTop: gi > 0 ? '2px solid hsl(var(--border)/0.5)' : undefined }}>
                    {/* ── Project header ── */}
                    <div className="flex items-center border-b border-border/30 cursor-pointer select-none"
                      style={{ height: GROUP_H }} onClick={() => toggleProject(pg.projectCode)}>
                      <div className="flex-shrink-0 sticky left-0 z-20 flex items-center gap-2 px-3 border-r border-border/30"
                        style={{ width: SIDEBAR_W, height: '100%', background: `color-mix(in srgb, ${projectColor} 20%, transparent)`, borderLeft: `4px solid ${projectColor}` }}>
                        {isCollapsed
                          ? <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                          : <ChevronDown  className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                        <div className="w-3 h-3 rounded-[3px] flex-shrink-0" style={{ background: projectColor }} />
                        <span className="font-bold text-sm truncate flex-1" style={{ color: projectColor }}>{pg.projectCode}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-1">({totalTaskCount})</span>
                      </div>
                      <div className="relative" style={{ width: totalWidth, height: '100%', background: `color-mix(in srgb, ${projectColor} 4%, transparent)` }}>
                        {months.map((m, i) => (
                          <div key={i} className="absolute top-0 bottom-0 border-r border-border/10" style={{ left: m.left + m.width }} />
                        ))}
                      </div>
                    </div>

                    {/* ── Sub-groups ── */}
                    {!isCollapsed && pg.subgroups.map(sg => {
                      const sgColor    = sg.key !== '__none__' ? getGroupColor(sg.colorId) : projectColor;
                      const sgKey      = `${pg.projectCode}::${sg.key}`;
                      const sgCollapsed = collapsedSubgroups.has(sgKey);
                      const showHeader  = pg.subgroups.length > 1 || sg.key !== '__none__';

                      return (
                        <div key={sg.key}>
                          {showHeader && (
                            <div className="flex items-center border-b border-border/20 cursor-pointer select-none"
                              style={{ height: SUBGROUP_H }}
                              onClick={() => toggleSubgroup(sgKey)}>
                              <div className="flex-shrink-0 sticky left-0 z-20 flex items-center gap-2 pl-8 pr-3 border-r border-border/20"
                                style={{ width: SIDEBAR_W, height: '100%', background: pastelBg(sgColor), borderLeft: `3px solid ${sgColor}` }}>
                                {sgCollapsed
                                  ? <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />
                                  : <ChevronDown  className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />}
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sgColor }} />
                                <span className="text-[11px] font-medium truncate flex-1" style={{ color: sgColor }}>{sg.label}</span>
                                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">({sg.tasks.length})</span>
                              </div>
                              <div className="relative" style={{ width: totalWidth, height: '100%', background: pastelBg(sgColor) }}>
                                {months.map((m, i) => (
                                  <div key={i} className="absolute top-0 bottom-0 border-r border-border/10" style={{ left: m.left + m.width }} />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Task rows */}
                          {!sgCollapsed && sg.tasks.map(task => {
                            const isDragging = dragPreview?.taskId === task.id;
                            const bLeftBase  = differenceInDays(pd(task.startDate!), minDate) * ppd;
                            const bWidthBase = Math.max(ppd, (differenceInDays(pd(task.endDate!), pd(task.startDate!)) + 1) * ppd);
                            const bLeft  = isDragging ? dragPreview!.bLeft  : bLeftBase;
                            const bWidth = isDragging ? dragPreview!.bWidth : bWidthBase;
                            const effectiveColor = localColors.get(task.id) ?? task.taskColor;
                            const barColor = getBarColor(task, sgColor);
                            const statusDot = STATUS_COLOR[task.status ?? ''] ?? '#94a3b8';
                            const canResize = !!task.boardId && !!task.startDate && !!task.endDate;

                            return (
                              <div key={task.id} className="flex items-center border-b border-border/10 hover:bg-muted/5 group" style={{ height: ROW_H }}>
                                <div className="flex-shrink-0 sticky left-0 z-20 flex items-center gap-2 px-3 border-r border-border/15 bg-card"
                                  style={{ width: SIDEBAR_W, height: '100%', paddingLeft: showHeader ? 40 : 24 }}>
                                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-60" style={{ background: sgColor }} />
                                  <span className="text-xs text-muted-foreground truncate">{task.taskName || '(sin nombre)'}</span>
                                </div>
                                <div className="relative" style={{ width: totalWidth, height: '100%' }}>
                                  {months.map((m, i) => (
                                    <div key={i} className="absolute top-0 bottom-0 border-r border-border/10" style={{ left: m.left + m.width }} />
                                  ))}
                                  {/* ── Task bar ── */}
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 rounded-md"
                                    style={{
                                      left: bLeft, width: bWidth, height: ROW_H - 10,
                                      background: `color-mix(in srgb, ${barColor} 80%, transparent)`,
                                      border: `1.5px solid ${barColor}`,
                                      boxShadow: isDragging ? `0 2px 12px ${barColor}60` : `0 1px 4px ${barColor}30`,
                                      cursor: colorMode === 'color' ? 'default' : 'pointer',
                                      userSelect: 'none',
                                      transition: isDragging ? 'none' : undefined,
                                    }}
                                    onMouseEnter={e => {
                                      if (dragRef.current) return;
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setTooltip({ task: { ...task, taskColor: effectiveColor || task.taskColor }, x: r.left + r.width / 2, y: r.top });
                                    }}
                                    onMouseLeave={() => setTooltip(null)}
                                    onClick={() => {
                                      if (dragRef.current || justDragged.current) return;
                                      if (colorMode !== 'color') navigate(`/operacion/proyectos/${task.projectCode}`);
                                    }}
                                  >
                                    {/* Left resize handle */}
                                    {canResize && (
                                      <div
                                        className="absolute left-0 top-0 bottom-0 w-3 z-20 cursor-col-resize flex items-center justify-center rounded-l-sm hover:bg-white/20 transition-colors"
                                        onMouseDown={e => startResize(e, task, 'left')}
                                        onMouseEnter={() => setTooltip(null)}
                                      >
                                        <div className="w-px h-3 bg-white/60 rounded-full" />
                                      </div>
                                    )}

                                    {/* Bar content */}
                                    <div className="absolute inset-0 flex items-center gap-1.5 pl-3 pr-3 overflow-hidden pointer-events-none">
                                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-white/40" style={{ background: statusDot }} />
                                      {bWidth > 72 && (
                                        <span className="text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
                                          {task.taskName}
                                        </span>
                                      )}
                                    </div>

                                    {/* Color picker overlay */}
                                    {colorMode === 'color' && task.colorColumnId && (
                                      <BarColorPicker task={task} recentColors={recentColors} onColorChange={handleColorChange} />
                                    )}

                                    {/* Right resize handle */}
                                    {canResize && (
                                      <div
                                        className="absolute right-0 top-0 bottom-0 w-3 z-20 cursor-col-resize flex items-center justify-center rounded-r-sm hover:bg-white/20 transition-colors"
                                        onMouseDown={e => startResize(e, task, 'right')}
                                        onMouseEnter={() => setTooltip(null)}
                                      >
                                        <div className="w-px h-3 bg-white/60 rounded-full" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div style={{ height: 8 }} />
            </div>
          </div>
        </div>
      </div>
      )}

      {tooltip && !dragPreview && <GanttTooltip data={tooltip} />}
      {dragPreview && <DragTooltip preview={dragPreview} />}
    </div>
  );
}
