import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Check, Undo2, CalendarClock, Trash2, User, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SLOT_H = 48;
const TIME_W = 52;
const DAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_ES_LONG = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const AUTO_DISMISS_MS = 8000;

export const CHART_VARS = ['--chart-1','--chart-2','--chart-3','--chart-4','--chart-5'];

export const LOCATION_COLORS: Record<string, string> = {
  'Online':   'hsl(199 89% 48%)',
  'Sala 5-A': 'hsl(217 91% 60%)',
  'Sala 5-B': 'hsl(262 80% 60%)',
  'Sala 5-C': 'hsl(240 70% 55%)',
  'Sala 6-A': 'hsl(142 71% 45%)',
  'Sala 6-B': 'hsl(160 65% 40%)',
  'Sala 6-D': 'hsl(38 92% 50%)',
  'Sala 6-F': 'hsl(25 90% 50%)',
  'Sala 6-G': 'hsl(330 70% 55%)',
  'Sala 6-H': 'hsl(0 72% 55%)',
};
const LOCATION_COLOR_FALLBACK = 'hsl(0 0% 60%)';

export function getLocationColor(loc?: string): string {
  if (!loc) return LOCATION_COLOR_FALLBACK;
  return LOCATION_COLORS[loc] ?? LOCATION_COLOR_FALLBACK;
}

export function hashStr(s: string): number {
  return Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
}

export function getProjectColorVar(code?: string): string {
  return CHART_VARS[hashStr(code ?? '') % CHART_VARS.length];
}

export function getAttendeeColor(name: string): string {
  const hue = (hashStr(name.trim()) * 137) % 360;
  return `hsl(${hue} 70% 55%)`;
}

type ColorBy = 'persona' | 'lugar';

function getMonday(d: Date): Date {
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1)); r.setHours(0,0,0,0); return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const dayIdx = (d.getDay() + 6) % 7;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DAYS_ES_LONG[dayIdx]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}min` : `${whole}h`;
}

// Convert a direct HSL string → a slightly transparent version for backgrounds
function hslWithAlpha(hslStr: string, alpha: number): string {
  // hslStr is like "hsl(142 71% 45%)"
  const inner = hslStr.replace('hsl(', '').replace(')', '').trim();
  return `hsl(${inner} / ${alpha})`;
}

export interface CalEventItem {
  id: string;
  eventName?: string;
  projectCode?: string;
  eventDate?: string;
  durationHours?: number;
  location?: string;
  attendees?: string;
  notes?: string;
  inviteStatus?: string;
  outlookEventId?: string;
  outlookEventLink?: string;
  inviteBodyHtml?: string;
  inviteEmails?: string;
}

interface PendingDrop {
  id: string;
  eventName: string;
  prevDateISO: string;
  newDateISO: string;
}

interface ResizeState {
  id: string;
  duration: number;
  mouseX: number;
  mouseY: number;
}

interface Props {
  events: CalEventItem[];
  onEventUpdate: (id: string, newEventDate: string) => Promise<void>;
  onEventClick: (event: CalEventItem) => void;
  onEventResize?: (id: string, newDurationHours: number) => Promise<void>;
  onWeekChange?: (from: Date, to: Date) => void;
  onEventCreate?: (eventName: string, eventDate: string) => Promise<void>;
  onEventDelete?: (id: string) => void;
}

interface NewEventDraft {
  dayIdx: number;
  hour: number;
  name: string;
}

// ── Outlook-style event layout: side-by-side concurrent events ────────────────
type LayoutItem = { id: string; start: number; end: number };

function computeEventLayout(
  events: CalEventItem[],
): Map<string, { column: number; totalColumns: number }> {
  const result = new Map<string, { column: number; totalColumns: number }>();
  if (events.length === 0) return result;

  const items: LayoutItem[] = events
    .filter(ev => ev.eventDate)
    .map(ev => {
      const d = new Date(ev.eventDate!);
      const start = d.getHours() + d.getMinutes() / 60;
      const dur = Math.max(0.25, ev.durationHours ?? 1);
      return { id: ev.id, start, end: start + dur };
    });

  // Sort by start time, then longer events first
  items.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Build transitive collision groups
  const groups: LayoutItem[][] = [];

  for (const item of items) {
    const overlapping: LayoutItem[][] = [];
    const rest: LayoutItem[][] = [];
    for (const group of groups) {
      if (group.some(g => item.start < g.end && item.end > g.start)) {
        overlapping.push(group);
      } else {
        rest.push(group);
      }
    }
    if (overlapping.length === 0) {
      rest.push([item]);
    } else {
      const merged: LayoutItem[] = [item];
      for (const g of overlapping) merged.push(...g);
      rest.push(merged);
    }
    groups.length = 0;
    groups.push(...rest);
  }

  // Greedy column assignment within each group
  for (const group of groups) {
    group.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const colEnds: number[] = [];
    const assignments = new Map<string, number>();
    for (const item of group) {
      let col = colEnds.findIndex(end => end <= item.start);
      if (col === -1) col = colEnds.length;
      if (col === colEnds.length) colEnds.push(0);
      colEnds[col] = item.end;
      assignments.set(item.id, col);
    }
    const totalColumns = colEnds.length;
    for (const item of group) {
      result.set(item.id, { column: assignments.get(item.id)!, totalColumns });
    }
  }

  return result;
}

export default function WeeklyCalendar({ events, onEventUpdate, onEventClick, onEventResize, onWeekChange, onEventCreate, onEventDelete }: Props) {
  const [wkStart, setWkStart] = useState<Date>(() => getMonday(new Date()));
  const [sh, setSh] = useState<number>(() => { try { return +(localStorage.getItem('cal-sh') ?? '8'); } catch { return 8; } });
  const [eh, setEh] = useState<number>(() => { try { return +(localStorage.getItem('cal-eh') ?? '22'); } catch { return 22; } });
  const [colorBy, setColorBy] = useState<ColorBy>(() => {
    try { return (localStorage.getItem('cal-color-by') as ColorBy) ?? 'lugar'; } catch { return 'lugar'; }
  });

  const handleColorBy = (v: ColorBy) => {
    setColorBy(v);
    try { localStorage.setItem('cal-color-by', v); } catch {}
  };

  // Drag-to-move state
  const dragRef = useRef<{ id: string; off: number } | null>(null);
  const [overDay, setOverDay] = useState<number | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [saving, setSaving] = useState(false);
  const [countdown, setCountdown] = useState(100);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef<number>(0);

  // New event draft (double-click to create)
  const [newEventDraft, setNewEventDraft] = useState<NewEventDraft | null>(null);
  const [draftCreating, setDraftCreating] = useState(false);
  const draftInputRef = useRef<HTMLInputElement>(null);

  // Drag-to-resize state
  const resizeRef = useRef<{ id: string; startY: number; origDuration: number } | null>(null);
  const resizingDurRef = useRef<number | null>(null);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const onEventResizeRef = useRef(onEventResize);
  onEventResizeRef.current = onEventResize;
  const shRef = useRef(sh); shRef.current = sh;
  const ehRef = useRef(eh); ehRef.current = eh;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wkStart, i)), [wkStart]);
  const hrs = useMemo(() => Array.from({ length: Math.max(1, eh - sh) }, (_, i) => sh + i), [sh, eh]);
  const totalH = SLOT_H * hrs.length;

  useEffect(() => { localStorage.setItem('cal-sh', String(sh)); }, [sh]);
  useEffect(() => { localStorage.setItem('cal-eh', String(eh)); }, [eh]);

  const visualEvents = useMemo(() => {
    let evs = events;
    if (pendingDrop) {
      evs = evs.map(ev => ev.id === pendingDrop.id ? { ...ev, eventDate: pendingDrop.newDateISO } : ev);
    }
    if (resizing) {
      evs = evs.map(ev => ev.id === resizing.id ? { ...ev, durationHours: resizing.duration } : ev);
    }
    return evs;
  }, [events, pendingDrop, resizing]);

  const clearTimers = () => {
    if (timerRef.current)   { clearTimeout(timerRef.current);  timerRef.current   = null; }
    if (intervalRef.current){ clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const startAutoRevert = () => {
    clearTimers();
    setCountdown(100);
    startTsRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTsRef.current;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setCountdown(pct);
    }, 50);
    timerRef.current = setTimeout(() => {
      setPendingDrop(null);
      clearTimers();
    }, AUTO_DISMISS_MS);
  };

  const handleConfirm = async () => {
    if (!pendingDrop || saving) return;
    clearTimers();
    setSaving(true);
    try {
      await onEventUpdate(pendingDrop.id, pendingDrop.newDateISO);
    } finally {
      setSaving(false);
      setPendingDrop(null);
    }
  };

  const handleRevert = () => {
    clearTimers();
    setPendingDrop(null);
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dy = e.clientY - resizeRef.current.startY;
      const deltaHours = dy / SLOT_H;
      const rawDuration = resizeRef.current.origDuration + deltaHours;
      const snapped = Math.max(0.25, Math.round(rawDuration * 4) / 4);
      resizingDurRef.current = snapped;
      setResizing({ id: resizeRef.current.id, duration: snapped, mouseX: e.clientX, mouseY: e.clientY });
    };

    const handleMouseUp = () => {
      if (!resizeRef.current) return;
      const id = resizeRef.current.id;
      const origDur = resizeRef.current.origDuration;
      const newDur = resizingDurRef.current ?? origDur;
      resizeRef.current = null;
      resizingDurRef.current = null;
      document.body.style.cursor = '';
      setResizing(null);
      if (newDur !== origDur) {
        onEventResizeRef.current?.(id, newDur);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const goWeek = useCallback((delta: number) => {
    setWkStart(prev => {
      const next = addDays(prev, delta * 7);
      onWeekChange?.(next, addDays(next, 6));
      return next;
    });
  }, [onWeekChange]);

  const goToday = useCallback(() => {
    const m = getMonday(new Date());
    setWkStart(m);
    onWeekChange?.(m, addDays(m, 6));
  }, [onWeekChange]);

  const onWkChangeRef = useRef(onWeekChange);
  onWkChangeRef.current = onWeekChange;
  useEffect(() => {
    onWkChangeRef.current?.(wkStart, addDays(wkStart, 6));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<number, CalEventItem[]>();
    for (let i = 0; i < 7; i++) m.set(i, []);
    for (const ev of visualEvents) {
      if (!ev.eventDate) continue;
      const d = new Date(ev.eventDate);
      const idx = days.findIndex(wd => sameDay(wd, d));
      if (idx >= 0) m.get(idx)!.push(ev);
    }
    return m;
  }, [visualEvents, days]);

  // ── Per-day layout maps for side-by-side concurrent event rendering ──────────
  const dayLayouts = useMemo(() => {
    const layouts = new Map<number, Map<string, { column: number; totalColumns: number }>>();
    for (let di = 0; di < 7; di++) {
      const evs = byDay.get(di) ?? [];
      const allEvs: CalEventItem[] = [...evs];
      // Include the draft event so it participates in collision detection
      if (newEventDraft && newEventDraft.dayIdx === di) {
        const d = new Date(days[di]);
        const h = Math.floor(newEventDraft.hour);
        const m = Math.round((newEventDraft.hour - h) * 60);
        d.setHours(h, m, 0, 0);
        allEvs.push({ id: '__draft__', eventDate: d.toISOString(), durationHours: 1 });
      }
      layouts.set(di, computeEventLayout(allEvs));
    }
    return layouts;
  }, [byDay, newEventDraft, days]);

  // Collect unique persons and locations visible this week
  const weekAttendees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const evs of byDay.values()) {
      for (const ev of evs) {
        if (!ev.attendees) continue;
        for (const raw of ev.attendees.split(',')) {
          const name = raw.trim();
          if (name && !seen.has(name)) seen.set(name, getAttendeeColor(name));
          if (seen.size >= 8) break;
        }
        if (seen.size >= 8) break;
      }
      if (seen.size >= 8) break;
    }
    return [...seen.entries()];
  }, [byDay]);

  const weekLocations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const evs of byDay.values()) {
      for (const ev of evs) {
        if (ev.location) seen.set(ev.location, getLocationColor(ev.location));
      }
    }
    return [...seen.entries()];
  }, [byDay]);

  const now = new Date();
  const todayIdx = days.findIndex(d => sameDay(d, now));
  const nowPct = ((now.getHours() + now.getMinutes() / 60 - sh) / (eh - sh)) * 100;

  function onDragStart(e: React.DragEvent, ev: CalEventItem) {
    if (!ev.eventDate || resizeRef.current) { e.preventDefault(); return; }
    const durFrac = (ev.durationHours ?? 1) / (eh - sh);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { id: ev.id, off: ((e.clientY - rect.top) / rect.height) * durFrac };
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDrop(e: React.DragEvent, dayIdx: number) {
    e.preventDefault();
    if (!dragRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientY - rect.top) / totalH));
    const raw = sh + rel * (eh - sh) - dragRef.current.off * (eh - sh);
    const snapped = Math.max(sh, Math.min(eh - 0.25, Math.round(raw * 4) / 4));
    const h = Math.floor(snapped), m = Math.round((snapped - h) * 60);
    const nd = new Date(days[dayIdx]); nd.setHours(h, m, 0, 0);
    const newISO = nd.toISOString();
    const srcEvent = events.find(ev => ev.id === dragRef.current!.id);
    if (!srcEvent) { dragRef.current = null; setOverDay(null); return; }
    const prevISO = srcEvent.eventDate ?? newISO;
    setPendingDrop({ id: srcEvent.id, eventName: srcEvent.eventName ?? 'Evento', prevDateISO: prevISO, newDateISO: newISO });
    startAutoRevert();
    dragRef.current = null;
    setOverDay(null);
  }

  function startResize(e: React.MouseEvent, ev: CalEventItem) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { id: ev.id, startY: e.clientY, origDuration: ev.durationHours ?? 1 };
    resizingDurRef.current = ev.durationHours ?? 1;
    document.body.style.cursor = 'ns-resize';
    setResizing({ id: ev.id, duration: ev.durationHours ?? 1, mouseX: e.clientX, mouseY: e.clientY });
  }

  function handleDayDoubleClick(e: React.MouseEvent, dayIdx: number) {
    if (!onEventCreate) return;
    if (resizeRef.current || dragRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientY - rect.top) / totalH));
    const raw = sh + rel * (eh - sh);
    const snapped = Math.max(sh, Math.min(eh - 1, Math.round(raw * 2) / 2));
    setNewEventDraft({ dayIdx, hour: snapped, name: '' });
    setTimeout(() => draftInputRef.current?.focus(), 30);
  }

  async function commitDraft() {
    if (!newEventDraft || !onEventCreate || draftCreating) return;
    const name = newEventDraft.name.trim();
    if (!name) { setNewEventDraft(null); return; }
    const h = Math.floor(newEventDraft.hour);
    const m = Math.round((newEventDraft.hour - h) * 60);
    const nd = new Date(days[newEventDraft.dayIdx]);
    nd.setHours(h, m, 0, 0);
    setDraftCreating(true);
    try {
      await onEventCreate(name, nd.toISOString());
    } finally {
      setDraftCreating(false);
      setNewEventDraft(null);
    }
  }

  function renderDraftBlock(dayIdx: number, layoutInfo?: { column: number; totalColumns: number }) {
    const _col = layoutInfo?.column ?? 0;
    const _totalCols = layoutInfo?.totalColumns ?? 1;
    if (!newEventDraft || newEventDraft.dayIdx !== dayIdx) return null;
    const startFrac = (newEventDraft.hour - sh) / (eh - sh);
    if (startFrac >= 1 || startFrac < 0) return null;
    const top = startFrac * 100;
    const height = (1 / (eh - sh)) * 100;
    return (
      <div
        key="draft"
        style={{
          position: 'absolute', top: `${top}%`, height: `${height}%`,
          left: `calc(${(_col / _totalCols) * 100}% + 1px)`,
          width: `calc(${(1 / _totalCols) * 100}% - 2px)`,
          zIndex: 30, minHeight: 28,
          background: 'hsl(var(--primary) / 0.08)',
          border: '2px dashed hsl(var(--primary) / 0.6)',
          borderRadius: 6, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {draftCreating ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid hsl(var(--primary) / 0.4)', borderTopColor: 'hsl(var(--primary))', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'hsl(var(--primary))', fontWeight: 600 }}>Creando...</span>
          </div>
        ) : (
          <input
            ref={draftInputRef}
            value={newEventDraft.name}
            onChange={e => setNewEventDraft(d => d ? { ...d, name: e.target.value } : null)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitDraft(); }
              if (e.key === 'Escape') { e.preventDefault(); setNewEventDraft(null); }
            }}
            onBlur={() => { setTimeout(() => { if (!draftCreating) setNewEventDraft(null); }, 150); }}
            placeholder="Nombre del evento..."
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, fontWeight: 600, color: 'hsl(var(--primary))',
              padding: '2px 6px', width: '100%',
            }}
          />
        )}
      </div>
    );
  }

  function renderBlock(ev: CalEventItem, layoutInfo?: { column: number; totalColumns: number }) {
    const _col = layoutInfo?.column ?? 0;
    const _totalCols = layoutInfo?.totalColumns ?? 1;
    if (!ev.eventDate) return null;
    const isPending = pendingDrop?.id === ev.id;
    const isResizing = resizing?.id === ev.id;
    const d = new Date(ev.eventDate);
    const startFrac = (d.getHours() + d.getMinutes() / 60 - sh) / (eh - sh);
    if (startFrac >= 1 || startFrac + (ev.durationHours ?? 1) / (eh - sh) < 0) return null;
    const top = Math.max(0, startFrac) * 100;
    const height = Math.max(0.04, Math.min((ev.durationHours ?? 1) / (eh - sh), 1 - Math.max(0, startFrac))) * 100;

    const firstAttendee = ev.attendees?.split(',')[0]?.trim() || '';
    const attendeeColor = firstAttendee ? getAttendeeColor(firstAttendee) : null;
    const locationColor = ev.location ? getLocationColor(ev.location) : null;

    // ── Determine main block color ────────────────────────────────────────────
    // colorBy === 'persona': use attendee color as main
    // colorBy === 'lugar':   use location color as main
    // fallback (no data):    use project CSS var

    const useDirectColor =
      colorBy === 'persona' ? !!attendeeColor :
      colorBy === 'lugar'   ? !!locationColor :
      false;

    const mainColor =
      colorBy === 'persona' ? attendeeColor :
      colorBy === 'lugar'   ? locationColor :
      null;

    const secondaryColor =
      colorBy === 'persona' ? locationColor :   // dot inside = location
      colorBy === 'lugar'   ? attendeeColor :   // dot inside = person
      null;

    const secondaryLabel =
      colorBy === 'persona' ? ev.location :
      colorBy === 'lugar'   ? firstAttendee :
      null;

    // CSS-var-based fallback (project color)
    const cv = getProjectColorVar(ev.projectCode);

    const blockBg = isPending
      ? (useDirectColor && mainColor
          ? hslWithAlpha(mainColor, 0.08)
          : `hsl(var(${cv}) / 0.08)`)
      : (useDirectColor && mainColor
          ? hslWithAlpha(mainColor, 0.18)
          : `hsl(var(${cv}) / 0.15)`);

    const blockBorderColor = useDirectColor && mainColor
      ? mainColor
      : `hsl(var(${cv}))`;

    const blockTextColor = useDirectColor && mainColor
      ? mainColor
      : `hsl(var(${cv}))`;

    return (
      <div
        key={ev.id}
        draggable
        onDragStart={e2 => onDragStart(e2, ev)}
        onClick={e2 => { if (resizeRef.current) return; e2.stopPropagation(); onEventClick(ev); }}
        style={{
          position: 'absolute', top: `${top}%`, height: `${height}%`,
          left: `calc(${(_col / _totalCols) * 100}% + 1px)`,
          width: `calc(${(1 / _totalCols) * 100}% - 2px)`,
          backgroundColor: blockBg,
          border: isPending ? `2px dashed ${blockBorderColor}` : 'none',
          borderLeft: isPending
            ? `3px dashed ${blockBorderColor}`
            : `3px solid ${blockBorderColor}`,
          color: blockTextColor,
          borderRadius: 4, overflow: 'hidden', zIndex: isResizing ? 20 : 10, minHeight: 18,
          cursor: isPending ? 'default' : isResizing ? 'ns-resize' : 'grab',
          opacity: isPending ? 0.75 : 1,
          transition: isResizing ? 'none' : 'opacity 0.2s, background-color 0.2s',
          userSelect: 'none',
        }}
        className={`group px-1.5 py-0.5 select-none hover:brightness-95 transition-all${isPending ? ' animate-pulse' : ''}`}
      >
        {/* Event name */}
        <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {ev.eventName}
        </div>

        {/* Secondary dimension dot + label */}
        {secondaryColor && secondaryLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 500, marginTop: 1 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: secondaryColor, flexShrink: 0, border: '1px solid rgba(255,255,255,0.4)' }} />
            <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', opacity: 0.85 }}>{secondaryLabel}</span>
          </div>
        )}

        {/* Project code badge (only when coloring by non-project dimension) */}
        {ev.projectCode && useDirectColor && (
          <span style={{
            fontSize: 9, background: blockBorderColor, color: '#fff',
            borderRadius: 2, padding: '0 3px', display: 'inline-block', opacity: 0.85, marginTop: 1,
          }}>
            {ev.projectCode}
          </span>
        )}

        {/* Fallback: show both attendee + location dots when coloring by project */}
        {!useDirectColor && (
          <>
            {attendeeColor && firstAttendee && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 500, marginTop: 1 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: attendeeColor, flexShrink: 0, border: '1px solid rgba(255,255,255,0.4)' }} />
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{firstAttendee}</span>
              </div>
            )}
            {ev.projectCode && (
              <span style={{ fontSize: 9, background: `hsl(var(${cv}))`, color: '#fff', borderRadius: 2, padding: '0 3px', display: 'inline-block', opacity: 0.9, marginTop: 1 }}>
                {ev.projectCode}
              </span>
            )}
            {ev.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, marginTop: 1 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: getLocationColor(ev.location), flexShrink: 0, border: '1px solid rgba(255,255,255,0.4)' }} />
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', opacity: 0.85 }}>{ev.location}</span>
              </div>
            )}
          </>
        )}

        {/* Delete button */}
        {onEventDelete && !isPending && (
          <button
            draggable={false}
            onDragStart={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); onEventDelete(ev.id); }}
            onMouseDown={e => e.stopPropagation()}
            title="Eliminar evento"
            style={{
              position: 'absolute', top: 0, right: 0,
              background: `${blockBorderColor}55`,
              borderRadius: '0 3px 0 3px',
              padding: '2px 3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: blockBorderColor,
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity hover:brightness-75"
          >
            <Trash2 style={{ width: 10, height: 10 }} />
          </button>
        )}

        {/* Resize handle */}
        {onEventResize && !isPending && (
          <div
            draggable={false}
            onDragStart={e => e.preventDefault()}
            onMouseDown={e => startResize(e, ev)}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 8,
              cursor: 'ns-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '0 0 3px 3px',
            }}
            title="Arrastrar para cambiar duración"
          >
            <div style={{ width: 20, height: 2, borderRadius: 1, background: `${blockBorderColor}bb`, transition: 'width 0.15s' }} />
          </div>
        )}
      </div>
    );
  }

  const hourOpts = Array.from({ length: 24 }, (_, i) => i);

  // Active vs inactive legend items
  const activeLegendItems   = colorBy === 'lugar' ? weekLocations   : weekAttendees;
  const inactiveLegendItems = colorBy === 'lugar' ? weekAttendees   : weekLocations;
  const activeLabel   = colorBy === 'lugar' ? 'Lugar' : 'Persona';
  const inactiveLabel = colorBy === 'lugar' ? 'Persona' : 'Lugar';

  return (
    <div className="flex flex-col bg-card border rounded-xl relative" style={{ overflow: 'visible' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b gap-3 flex-wrap bg-card">
        {/* Week nav */}
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goWeek(-1)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-sm font-semibold w-52 text-center tabular-nums select-none">
            {days[0].getDate()} {MONTHS_ES[days[0].getMonth()]} — {days[6].getDate()} {MONTHS_ES[days[6].getMonth()]} {days[6].getFullYear()}
          </span>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goWeek(1)}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={goToday}>Hoy</Button>
        </div>

        {/* Legends */}
        <div className="hidden lg:flex flex-col gap-1 flex-1 min-w-0 px-2">
          {/* Active dimension — more prominent */}
          {activeLegendItems.length > 0 && (
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/70 flex-shrink-0">{activeLabel}</span>
              {activeLegendItems.map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span className="text-[10px] text-foreground/70 font-medium">{label}</span>
                </div>
              ))}
            </div>
          )}
          {/* Inactive dimension — subtle */}
          {inactiveLegendItems.length > 0 && (
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 flex-shrink-0">{inactiveLabel}</span>
              {inactiveLegendItems.map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, opacity: 0.5 }} />
                  <span className="text-[10px] text-muted-foreground/50">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Color-by toggle */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground font-medium hidden sm:block">Colorear por</span>
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => handleColorBy('persona')}
              title="Colorear por persona"
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${
                colorBy === 'persona'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <User className="w-3 h-3" />
              <span className="hidden sm:inline">Persona</span>
            </button>
            <button
              type="button"
              onClick={() => handleColorBy('lugar')}
              title="Colorear por lugar"
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-border ${
                colorBy === 'lugar'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <MapPin className="w-3 h-3" />
              <span className="hidden sm:inline">Lugar</span>
            </button>
          </div>
        </div>

        {onEventCreate && (
          <div className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground/40 italic select-none">
            <span>Doble-click para crear evento</span>
          </div>
        )}

        {/* Time range selectors */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <Select value={String(sh)} onValueChange={v => setSh(+v)}>
            <SelectTrigger className="h-7 w-[68px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{hourOpts.slice(0, 23).map(h => <SelectItem key={h} value={String(h)}>{String(h).padStart(2,'0')}:00</SelectItem>)}</SelectContent>
          </Select>
          <span>a</span>
          <Select value={String(eh)} onValueChange={v => setEh(+v)}>
            <SelectTrigger className="h-7 w-[68px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{hourOpts.slice(1).map(h => <SelectItem key={h} value={String(h)}>{String(h).padStart(2,'0')}:00</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-b-xl" style={{ maxHeight: '85vh' }}>
        {/* Day header row */}
        <div className="flex sticky top-0 z-30 bg-card border-b">
          <div style={{ width: TIME_W, flexShrink: 0 }} />
          {days.map((day, i) => {
            const isToday = sameDay(day, now);
            return (
              <div key={i} className={`flex-1 min-w-[80px] py-2 text-center border-l ${isToday ? 'bg-primary/5' : ''}`}>
                <div className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{DAYS_ES[i]}</div>
                <div className={`mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="flex">
          <div style={{ width: TIME_W, flexShrink: 0 }}>
            {hrs.map(h => (
              <div key={h} style={{ height: SLOT_H }} className="flex items-start justify-end pr-2 pt-1">
                <span className="text-[10px] text-muted-foreground/50 tabular-nums leading-none">{String(h).padStart(2,'0')}:00</span>
              </div>
            ))}
          </div>

          {days.map((day, di) => {
            const evs = byDay.get(di) ?? [];
            const isToday = sameDay(day, now);
            return (
              <div
                key={di}
                className={`flex-1 min-w-[80px] border-l relative ${isToday ? 'bg-primary/[0.015]' : ''} ${overDay === di ? 'bg-accent/20' : ''}`}
                style={{ height: totalH }}
                onDragOver={e => { e.preventDefault(); setOverDay(di); }}
                onDrop={e => onDrop(e, di)}
                onDragLeave={() => setOverDay(null)}
                onDoubleClick={e => handleDayDoubleClick(e, di)}
              >
                {hrs.map((h, i) => (
                  <React.Fragment key={h}>
                    <div style={{ position: 'absolute', top: i * SLOT_H, left: 0, right: 0, height: SLOT_H }} className="border-t border-border/20" />
                    <div style={{ position: 'absolute', top: i * SLOT_H + SLOT_H / 2, left: 0, right: 0 }} className="border-t border-dashed border-border/10" />
                  </React.Fragment>
                ))}
                {evs.map(ev => renderBlock(ev, dayLayouts.get(di)?.get(ev.id)))}
                {renderDraftBlock(di, dayLayouts.get(di)?.get('__draft__'))}
                {isToday && todayIdx >= 0 && nowPct >= 0 && nowPct <= 100 && (
                  <div style={{ position: 'absolute', top: `${nowPct}%`, left: 0, right: 0, zIndex: 15, display: 'flex', alignItems: 'center' }}>
                    <div className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" style={{ marginLeft: -4 }} />
                    <div className="flex-1 h-px bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Pending drop confirmation bar ─────────────────────────────────────── */}
      {pendingDrop && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-0 bg-card border border-border shadow-xl rounded-xl overflow-hidden"
          style={{ minWidth: 320, maxWidth: 480, boxShadow: '0 8px 32px hsl(var(--foreground) / 0.12)' }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0">
              <CalendarClock className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{pendingDrop.eventName}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <span className="line-through opacity-50">{fmtDateTime(pendingDrop.prevDateISO)}</span>
                <span className="text-muted-foreground/40 mx-0.5">→</span>
                <span className="text-primary font-medium">{fmtDateTime(pendingDrop.newDateISO)}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs gap-1.5" onClick={handleRevert} disabled={saving}>
                <Undo2 className="w-3 h-3" />Deshacer
              </Button>
              <Button size="sm" className="h-7 px-3 text-xs gap-1.5" onClick={handleConfirm} disabled={saving}>
                {saving
                  ? <><span className="w-3 h-3 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />Guardando</>
                  : <><Check className="w-3 h-3" />Guardar</>
                }
              </Button>
            </div>
          </div>
          <div className="h-0.5 bg-muted w-full">
            <div className="h-full bg-primary/40 transition-none" style={{ width: `${countdown}%` }} />
          </div>
        </div>
      )}

      {/* ── Resize duration tooltip ───────────────────────────────────────────── */}
      {resizing && (
        <div
          className="fixed z-[300] bg-foreground text-background text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xl pointer-events-none"
          style={{ left: resizing.mouseX + 14, top: resizing.mouseY - 10 }}
        >
          {fmtDuration(resizing.duration)}
        </div>
      )}
    </div>
  );
}
