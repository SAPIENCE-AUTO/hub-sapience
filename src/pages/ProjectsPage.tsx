import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';

function fmtDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}
import { useNavigate } from 'react-router-dom';
import { getProjects, saveProject, deleteProject, getAllCalendarEvents, saveCalendarEvent, syncOutlookInvite, getTeamMembers, GetProjectsOutputType, GetTeamMembersOutputType } from 'zite-endpoints-sdk';
import TeamMemberPicker from '../components/TeamMemberPicker';
import TeamsChannelDialog from '../components/TeamsChannelDialog';
import WeeklyCalendar, { type CalEventItem, getProjectColorVar } from '../components/WeeklyCalendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge } from '../components/StatusBadge';
import ComboboxCreatable from '../components/ComboboxCreatable';
import { GanttTimeline } from '../components/GanttTimeline';
import { Plus, Pencil, Trash2, Search, LayoutGrid, List, ChevronRight, CalendarDays, ArrowUpAZ, ArrowDownAZ, ArrowUp, ArrowDown, ChevronDown, GanttChartSquare, MessageSquarePlus, ExternalLink, Loader2, RefreshCw, Calendar, MapPin, Users, Clock, X, Eye, Mail } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Project = GetProjectsOutputType['projects'][0];
type UserItem = GetTeamMembersOutputType['members'][0];

// "Prospecto" existe como fase de Deal, pero un Proyecto solo nace cuando un
// Deal se gana — nunca debería poder quedar en "Prospecto" (confirmado: 0 de
// 302 proyectos reales lo usan hoy). "Activo" era un valor legado (6 proyectos
// reales lo tenían) que se unificó con "En curso" — ver migración de datos.
const PROJECT_STATUSES = ['En curso', 'Stand by', 'Finalizado', 'Cancelado'];

const emptyForm = { projectCode: '', tematica: '', status: 'En curso', client: '', startDate: '', endDate: '', description: '', lider: [] as string[], analistas: [] as string[], moderadores: [] as string[], asistentes: [] as string[] };

// "En curso" ya incluye Stand by (antes existía un "Activos" aparte que
// combinaba los dos, y quedaba junto al chip individual "En curso" con
// statuses:['En curso'] — mismo color, nombre casi igual, se veían
// duplicados). Quien quiera solo los que están en pausa usa el chip
// "Stand by" aparte.
const STATUS_FILTERS = [
  { key: 'en-curso',   label: 'En curso',   statuses: ['En curso', 'Stand by'], dotClass: 'bg-chart-2' },
  { key: 'all',        label: 'Todos' },
  { key: 'stand-by',   label: 'Stand by',   statuses: ['Stand by'],   dotClass: 'bg-chart-4' },
  { key: 'finalizado', label: 'Finalizado', statuses: ['Finalizado'], dotClass: 'bg-muted-foreground' },
  { key: 'cancelado',  label: 'Cancelado',  statuses: ['Cancelado'],  dotClass: 'bg-destructive' },
] as const;
type FilterKey = typeof STATUS_FILTERS[number]['key'];
type ScopeKey = 'mine' | 'all';

const toIds = (v: string | string[] | null | undefined): string[] =>
  !v ? [] : Array.isArray(v) ? v : [v];

const isMyProject = (p: { lider?: string | string[] | null; analistas?: string | string[] | null; moderadores?: string | string[] | null; asistentes?: string | string[] | null }, userId: string) =>
  [...toIds(p.lider), ...toIds(p.analistas), ...toIds(p.moderadores), ...toIds(p.asistentes)].includes(userId);

type SortField = 'name' | 'startDate' | 'endDate' | 'client';
type SortDir = 'asc' | 'desc';

const statusBarStyle: Record<string, string> = {
  'En curso':   'bg-chart-2',
  'Stand by':   'bg-chart-4',
  'Finalizado': 'bg-muted-foreground',
  'Cancelado':  'bg-destructive',
};

// ── Column resize config ──────────────────────────────────────────────────────
const STORAGE_KEY = 'projects-col-widths';
const INITIAL_COL_WIDTHS = [130, 200, 150, 100, 100, 100, 220];
const MIN_COL_WIDTH = 60;

// ── Inline editable text/date cell ───────────────────────────────────────────
function InlineCell({ value, onSave, type = 'text', placeholder = '—', className = '' }: {
  value: string;
  onSave: (v: string) => void;
  type?: 'text' | 'date';
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); };
  const commit = () => { setEditing(false); if (draft !== value) onSave(draft); };
  const cancel = () => { setEditing(false); setDraft(value); };

  const displayText = (() => {
    if (type === 'date' && value) {
      const d = new Date(value + 'T00:00:00');
      if (isNaN(d.getTime())) return null;
      return fmtDate(d);
    }
    return value || null;
  })();

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        className={`w-full bg-background border border-primary/50 rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  const inner = (
    <span
      onClick={e => { e.stopPropagation(); startEdit(); }}
      title={type === 'text' ? undefined : 'Click para editar'}
      className={`cursor-text hover:bg-primary/5 rounded px-1 -mx-1 py-0.5 transition-colors block truncate ${className}`}
    >
      {displayText ?? <span className="text-muted-foreground/40 italic text-xs">{placeholder}</span>}
    </span>
  );

  // Show tooltip for text cells with content (date cells use native browser title)
  if (type === 'text' && displayText && displayText.length > 18) {
    return (
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>{inner}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">{displayText}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return inner;
}

// ── Inline status dropdown ────────────────────────────────────────────────────
function InlineStatus({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      value={value || 'En curso'}
      onValueChange={v => { onSave(v); setOpen(false); }}
      open={open}
      onOpenChange={setOpen}
    >
      <SelectTrigger
        className="h-auto border-none shadow-none p-0 gap-0 focus:ring-0 bg-transparent w-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={e => { e.stopPropagation(); setOpen(true); }}
          className="hover:opacity-75 transition-opacity flex items-center gap-1"
          title="Click para cambiar estado"
        >
          <StatusBadge status={value} />
        </button>
      </SelectTrigger>
      <SelectContent onClick={e => e.stopPropagation()}>
        {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Sort toggle button ────────────────────────────────────────────────────────
function SortToggle({ label, field, sortField, sortDir, onSort }: {
  label: string; field: SortField;
  sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      onClick={e => { e.stopPropagation(); onSort(field); }}
      className={`flex items-center gap-0.5 group transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="ml-0.5">
        {active
          ? (sortDir === 'asc'
              ? (field === 'name' ? <ArrowUpAZ className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)
              : (field === 'name' ? <ArrowDownAZ className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />))
          : <ArrowUpAZ className="w-3 h-3 opacity-30 group-hover:opacity-60" />}
      </span>
    </button>
  );
}

// ── Teams channel button ──────────────────────────────────────────────────────
function TeamsButton({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const status = p.teamsChannelStatus;
  const url    = p.teamsChannelUrl;

  if (status === 'Listo' && url) {
    return (
      <div className="flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-chart-2/10 text-chart-2 hover:bg-chart-2/20 transition-colors"
          title="Abrir canal en Teams"
        >
          <ExternalLink className="w-3 h-3" /> Canal Teams
        </a>
        <button
          onClick={e => { e.stopPropagation(); onOpen(); }}
          className="inline-flex items-center px-1.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
          title="Administrar canal"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); onOpen(); }}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
      title={status === 'Error' ? 'Reintentar canal de Teams' : 'Configurar canal de Teams'}
    >
      <MessageSquarePlus className="w-3 h-3" /> {status === 'Error' ? 'Reintentar' : 'Crear canal'}
    </button>
  );
}

// ── Project card (grid view) ──────────────────────────────────────────────────
function ProjectCard({ p, onEdit, onDelete, onOpen, onOpenTeams }: {
  p: Project; onEdit: () => void; onDelete: () => void; onOpen: () => void;
  onOpenTeams: () => void;
}) {
  const barCls = statusBarStyle[p.status ?? ''] ?? 'bg-border';
  return (
    <div onClick={onOpen} className="bg-card border rounded-xl p-5 cursor-pointer hover:shadow-md hover:border-primary/40 transition-all duration-200 flex flex-col gap-3 relative group overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${barCls}`} />
      <div className="pl-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-primary text-base leading-tight">{p.projectCode}</div>
            {p.tematica && (
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1 cursor-default">{p.tematica}</div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">{p.tematica}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="flex-shrink-0 mt-0.5"><StatusBadge status={p.status} /></div>
        </div>
        {p.client && <div className="text-xs text-muted-foreground mt-2 font-medium">{p.client}</div>}
        <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
          <CalendarDays className="w-3 h-3 flex-shrink-0" />
          <span className="truncate flex items-center gap-1">
            {(() => {
              const start = p.startDate || p.computedStartDate;
              const end   = p.endDate   || p.computedEndDate;
              const autoStart = !p.startDate && !!p.computedStartDate;
              const autoEnd   = !p.endDate   && !!p.computedEndDate;
              return (
                <>
                  <span className={autoStart ? 'italic opacity-55' : ''} title={autoStart ? 'Fecha calculada de actividades' : undefined}>
                    {start ? fmtDate(new Date(start + 'T00:00:00')) : '—'}
                  </span>
                  {end && (
                    <span className={autoEnd ? 'italic opacity-55' : ''} title={autoEnd ? 'Fecha calculada de actividades' : undefined}>
                      {` → ${fmtDate(new Date(end + 'T00:00:00'))}`}
                    </span>
                  )}
                </>
              );
            })()}
          </span>
        </div>
        <div className="mt-2" onClick={e => e.stopPropagation()}>
          <TeamsButton p={p} onOpen={onOpenTeams} />
        </div>
      </div>
      <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}><Pencil className="w-3 h-3" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────
function ProjectRow({ p, onOpen, onEdit, onDelete, onSaveField, onOpenTeams }: {
  p: Project; onOpen: () => void; onEdit: () => void; onDelete: () => void;
  onSaveField: (p: Project, field: string, value: string) => void;
  onOpenTeams: () => void;
}) {
  const barCls = statusBarStyle[p.status ?? ''] ?? 'bg-border';
  return (
    <tr className="group hover:bg-muted/25 border-t border-border/20">
      <td className="px-4 py-2.5 relative">
        <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${barCls}`} />
        <span
          onClick={onOpen}
          className="font-bold text-primary text-xs font-mono cursor-pointer hover:underline"
          title="Abrir proyecto"
        >
          {p.projectCode || '—'}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <InlineCell
          value={p.tematica ?? ''}
          onSave={v => onSaveField(p, 'tematica', v)}
          placeholder="—"
          className="text-sm text-muted-foreground"
        />
      </td>
      <td className="px-4 py-2.5">
        <InlineCell
          value={p.client ?? ''}
          onSave={v => onSaveField(p, 'client', v)}
          placeholder="—"
          className="text-sm"
        />
      </td>
      <td className="px-4 py-2.5">
        <InlineStatus value={p.status ?? 'En curso'} onSave={v => onSaveField(p, 'status', v)} />
      </td>
      <td className="px-4 py-2.5 text-xs">
        <InlineCell
          value={p.startDate ?? ''}
          onSave={v => onSaveField(p, 'startDate', v)}
          type="date"
          placeholder={p.computedStartDate ? `↗ ${fmtDate(new Date(p.computedStartDate + 'T00:00:00'))}` : '—'}
        />
      </td>
      <td className="px-4 py-2.5 text-xs">
        <InlineCell
          value={p.endDate ?? ''}
          onSave={v => onSaveField(p, 'endDate', v)}
          type="date"
          placeholder={p.computedEndDate ? `↗ ${fmtDate(new Date(p.computedEndDate + 'T00:00:00'))}` : '—'}
        />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <TeamsButton p={p} onOpen={onOpenTeams} />
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar (modal)" onClick={onEdit}><Pencil className="w-3 h-3" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="w-3 h-3" /></Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Resizable table header cell ───────────────────────────────────────────────
function ResizableTh({ children, colIdx, onResizeStart, className = '' }: {
  children: React.ReactNode;
  colIdx: number;
  onResizeStart: (e: React.MouseEvent, idx: number) => void;
  className?: string;
}) {
  return (
    <th className={`relative select-none ${className}`}>
      {children}
      <div
        onMouseDown={e => onResizeStart(e, colIdx)}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 hover:opacity-100 bg-primary/40 transition-opacity z-10"
      />
    </th>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('en-curso');
  const [clientFilter, setClientFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'lista' | 'timeline' | 'calendario'>('lista');
  const [teamsDialogProject, setTeamsDialogProject] = useState<Project | null>(null);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const { user } = useAuth();
  const [scope, setScope] = useState<ScopeKey>('all');
  const prefsLoadedRef = useRef(false);

  // ── Calendar state & helpers ──────────────────────────────────────────────────
  const PRESET_LOCS_CAL = ['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro'];
  const [calEvents, setCalEvents] = useState<CalEventItem[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calProjFilter, setCalProjFilter] = useState<Set<string>>(new Set());
  const [calLocFilter, setCalLocFilter] = useState('');
  const [selCalEvent, setSelCalEvent] = useState<CalEventItem | null>(null);
  const [calEvtOpen, setCalEvtOpen] = useState(false);
  const [calEvtEdit, setCalEvtEdit] = useState(false);
  const [calEvtSaving, setCalEvtSaving] = useState(false);
  const [outlookSyncing, setOutlookSyncing] = useState(false);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);
  const [calEvtForm, setCalEvtForm] = useState({ eventDate: '', durationHours: 1, location: '', attendees: '', inviteEmails: '', notes: '', locCustom: false });

  const loadCalEvents = async (from: Date, to: Date) => {
    setCalLoading(true);
    try {
      const buf1 = new Date(from); buf1.setDate(buf1.getDate() - 1);
      const buf2 = new Date(to); buf2.setDate(buf2.getDate() + 1);
      const res = await getAllCalendarEvents({ startDate: buf1.toISOString(), endDate: buf2.toISOString() });
      setCalEvents(res.events);
    } catch { /* silent */ }
    setCalLoading(false);
  };

  const handleCalEvtUpdate = async (id: string, newDate: string): Promise<void> => {
    // Optimistically update local state so the visual stays in place immediately
    setCalEvents(prev => prev.map(e => e.id === id ? { ...e, eventDate: newDate } : e));
    try { await saveCalendarEvent({ id, eventDate: newDate }); }
    catch {
      // Revert on failure by reloading fresh data
      loadCalEvents(new Date(newDate), new Date(newDate));
      toast.error('Error al mover evento');
    }
  };

  const openCalEvt = (ev: CalEventItem) => {
    setSelCalEvent(ev); setCalEvtEdit(false); setCalEvtOpen(true);
  };

  const startCalEvtEdit = () => {
    if (!selCalEvent) return;
    const d = selCalEvent.eventDate ? new Date(selCalEvent.eventDate) : null;
    const pad = (n: number) => String(n).padStart(2,'0');
    const dateStr = d ? `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    const isCustom = !!selCalEvent.location && !PRESET_LOCS_CAL.includes(selCalEvent.location);
    setCalEvtForm({ eventDate: dateStr, durationHours: selCalEvent.durationHours ?? 1, location: selCalEvent.location ?? '', attendees: selCalEvent.attendees ?? '', inviteEmails: selCalEvent.inviteEmails ?? '', notes: selCalEvent.notes ?? '', locCustom: isCustom });
    setCalEvtEdit(true);
  };

  const saveCalEvt = async () => {
    if (!selCalEvent) return;
    setCalEvtSaving(true);
    try {
      await saveCalendarEvent({
        id: selCalEvent.id,
        eventDate: calEvtForm.eventDate ? new Date(calEvtForm.eventDate).toISOString() : undefined,
        durationHours: calEvtForm.durationHours > 0 ? calEvtForm.durationHours : undefined,
        location: calEvtForm.location || undefined,
        attendees: calEvtForm.attendees || undefined,
        inviteEmails: calEvtForm.inviteEmails || undefined,
        notes: calEvtForm.notes || undefined,
      });
      toast.success('Evento actualizado');
      setCalEvents(prev => prev.map(e => e.id === selCalEvent.id ? {
        ...e,
        eventDate: calEvtForm.eventDate ? new Date(calEvtForm.eventDate).toISOString() : e.eventDate,
        durationHours: calEvtForm.durationHours,
        location: calEvtForm.location || e.location,
        attendees: calEvtForm.attendees || e.attendees,
        inviteEmails: calEvtForm.inviteEmails || e.inviteEmails,
        notes: calEvtForm.notes || e.notes,
      } : e));
      setCalEvtOpen(false);
    } catch { toast.error('Error al guardar'); }
    setCalEvtSaving(false);
  };

  const handleOutlookSync = async (action: 'create' | 'update' | 'cancel') => {
    if (!selCalEvent || outlookSyncing) return;
    setOutlookSyncing(true);
    try {
      const result = await syncOutlookInvite({ eventId: selCalEvent.id, action });
      if (result.success) {
        toast.success(action === 'cancel' ? 'Invitación cancelada en Outlook' : 'Sincronizado con Outlook ✓');
        const updatedEvent: typeof selCalEvent = {
          ...selCalEvent,
          inviteStatus: result.inviteStatus ?? selCalEvent.inviteStatus,
          outlookEventId: action === 'cancel' ? selCalEvent.outlookEventId : (result.outlookEventId ?? selCalEvent.outlookEventId),
          outlookEventLink: action === 'cancel' ? selCalEvent.outlookEventLink : (result.outlookEventLink ?? selCalEvent.outlookEventLink),
          inviteBodyHtml: result.inviteBodyHtml ?? selCalEvent.inviteBodyHtml,
        };
        setSelCalEvent(updatedEvent);
        setCalEvents(prev => prev.map(e => e.id === selCalEvent.id ? updatedEvent : e));
      } else {
        toast.error('Error al sincronizar con Outlook');
      }
    } catch { toast.error('Error al sincronizar con Outlook'); }
    finally { setOutlookSyncing(false); }
  };

  const filteredCalEvents = useMemo(() => {
    let evs = calEvents;
    if (calProjFilter.size > 0) evs = evs.filter(e => calProjFilter.has(e.projectCode ?? ''));
    if (calLocFilter) evs = evs.filter(e => e.location === calLocFilter);
    return evs;
  }, [calEvents, calProjFilter, calLocFilter]);

  const calProjectCodes = useMemo(() =>
    [...new Set(calEvents.map(e => e.projectCode).filter(Boolean) as string[])].sort(),
  [calEvents]);

  const calLocations = useMemo(() =>
    [...new Set(calEvents.map(e => e.location).filter(Boolean) as string[])].sort(),
  [calEvents]);

  // ── Column widths (resizable) ───────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as number[];
        if (Array.isArray(parsed) && parsed.length === INITIAL_COL_WIDTHS.length) return parsed;
      }
    } catch { /* ignore */ }
    return [...INITIAL_COL_WIDTHS];
  });

  // Persist widths to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  const onResizeStart = useCallback((e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colIdx];

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths(prev => {
        const next = [...prev];
        next[colIdx] = newWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [colWidths]);

  const load = () => {
    setLoading(true);
    getProjects({}).then(d => { setProjects(d.projects); setLoading(false); }).catch(() => { setLoading(false); toast.error('Error al cargar proyectos'); });
  };
  useEffect(() => {
    if (!user?.email) return;
    load();
    getTeamMembers({}).then(d => setUsers(d.members)).catch(() => {});
  }, [user?.email]);

  // Load per-user view prefs once projects + user are ready.
  // Llave con "-v2": todos tenían guardado el viejo default (statusFilter
  // 'all') de antes de que "En curso" pasara a ser el default — sin cambiar
  // la llave, ese valor persistido seguiría ganándole al default nuevo para
  // quien ya hubiera usado esta página, y solo lo verían los usuarios nuevos.
  useEffect(() => {
    if (!user?.id || loading || prefsLoadedRef.current) return;
    prefsLoadedRef.current = true;
    const saved = localStorage.getItem(`projects-view-prefs-v2-${user.id}`);
    if (saved) {
      try {
        const { scope: s, statusFilter: sf } = JSON.parse(saved);
        if (s === 'mine' || s === 'all') setScope(s);
        if (typeof sf === 'string') setStatusFilter(sf as FilterKey);
        return;
      } catch {}
    }
    // No saved prefs — default to 'mine' if user has assigned projects
    const hasMyProjects = projects.some(p => isMyProject(p, user.id));
    setScope(hasMyProjects ? 'mine' : 'all');
  }, [user?.id, loading, projects]);

  // Save prefs whenever scope or status filter changes
  useEffect(() => {
    if (!user?.id || !prefsLoadedRef.current) return;
    localStorage.setItem(`projects-view-prefs-v2-${user.id}`, JSON.stringify({ scope, statusFilter }));
  }, [scope, statusFilter, user?.id]);

  const openNew = () => {
    setEditing(null);
    // Default a hoy — antes se dejaba vacía si nadie la tocaba (ver ajuste solicitado).
    setForm({ ...emptyForm, startDate: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };
  const toIdArray = (v: string | string[] | null | undefined): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      projectCode: p.projectCode ?? '',
      tematica: p.tematica ?? '',
      status: p.status ?? 'En curso',
      client: p.client ?? '',
      startDate: p.startDate ?? '',
      endDate: p.endDate ?? '',
      description: p.description ?? '',
      lider: toIdArray(p.lider),
      analistas: toIdArray(p.analistas),
      moderadores: toIdArray(p.moderadores),
      asistentes: toIdArray(p.asistentes),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.projectCode.trim()) return toast.error('El nombre del proyecto es obligatorio');
    setSaving(true);
    try {
      const oldProjectCode = editing?.projectCode && editing.projectCode !== form.projectCode
        ? editing.projectCode
        : undefined;
      await saveProject({
        ...form,
        id: editing?.id,
        oldProjectCode,
        lider: form.lider[0] ?? '',
        analistas: form.analistas,
        moderadores: form.moderadores,
        asistentes: form.asistentes,
      });
      if (oldProjectCode) {
        toast.success('Proyecto renombrado y datos actualizados en cascada ✓');
      } else {
        toast.success(editing ? 'Proyecto actualizado' : 'Proyecto creado');
      }
      setOpen(false); load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    }
    setSaving(false);
  };

  const del = async () => {
    if (!deleting) return;
    await deleteProject({ id: deleting });
    toast.success('Proyecto eliminado');
    setDeleting(null); load();
  };

  const openTeamsDialog = (p: Project) => {
    setTeamsDialogProject(p);
    setTeamsDialogOpen(true);
  };

  const saveField = async (p: Project, field: string, value: string) => {
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, [field]: value } : x));
    try {
      await saveProject({ id: p.id, projectCode: p.projectCode ?? '', [field]: value });
    } catch { toast.error('Error al guardar'); load(); }
  };

  const myProjectCount = useMemo(() => {
    if (!user?.id) return 0;
    return projects.filter(p => isMyProject(p, user.id)).length;
  }, [projects, user]);

  const uniqueClients = useMemo(() =>
    [...new Set(projects.map(p => p.client).filter(Boolean) as string[])].sort(),
  [projects]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    const statusF = STATUS_FILTERS.find(x => x.key === statusFilter);
    return projects
      .filter(p => scope === 'mine' && user?.id ? isMyProject(p, user.id) : true)
      .filter(p => {
        if (statusFilter === 'all') return true;
        if (!statusF || !('statuses' in statusF)) return true;
        return ([...statusF.statuses] as string[]).includes(p.status ?? '');
      })
      .filter(p => clientFilter === 'all' || p.client === clientFilter)
      .filter(p => !search || [p.projectCode, p.tematica, p.client].some(v => v?.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'name') cmp = (a.projectCode ?? '').localeCompare(b.projectCode ?? '');
        else if (sortField === 'startDate') cmp = (a.startDate || (a.computedStartDate ?? '')).localeCompare(b.startDate || (b.computedStartDate ?? ''));
        else if (sortField === 'endDate') cmp = (a.endDate || (a.computedEndDate ?? '')).localeCompare(b.endDate || (b.computedEndDate ?? ''));
        else if (sortField === 'client') cmp = (a.client ?? '').localeCompare(b.client ?? '');
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [projects, statusFilter, clientFilter, search, sortField, sortDir, scope, user]);

  const countFor = (key: FilterKey) => {
    const f = STATUS_FILTERS.find(x => x.key === key);
    return projects
      .filter(p => scope === 'mine' && user?.id ? isMyProject(p, user.id) : true)
      .filter(p => {
        if (key === 'all') return true;
        if (!f || !('statuses' in f)) return true;
        return ([...f.statuses] as string[]).includes(p.status ?? '');
      }).length;
  };

  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const groups = useMemo(() => {
    const map = new Map<string, Project[]>();

    for (const p of filtered) {
      let key: string;
      if (sortField === 'client') {
        key = p.client?.trim() || 'Sin cliente';
      } else if (sortField === 'startDate' || sortField === 'endDate') {
        const dateVal = sortField === 'startDate'
          ? (p.startDate || p.computedStartDate)
          : (p.endDate || p.computedEndDate);
        if (dateVal) {
          const d = new Date(dateVal + (dateVal.length === 10 ? 'T00:00:00' : ''));
          if (!isNaN(d.getTime())) {
            key = `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
          } else {
            key = 'Sin fecha';
          }
        } else {
          key = 'Sin fecha';
        }
      } else {
        key = (p.projectCode?.[0] ?? '#').toUpperCase();
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }

    const entries = [...map.entries()];

    if (sortField === 'startDate' || sortField === 'endDate') {
      entries.sort(([a], [b]) => {
        if (a === 'Sin fecha') return 1;
        if (b === 'Sin fecha') return -1;
        // Parse "Mes YYYY" back to a sortable value
        const parseGroup = (s: string) => {
          const [mon, yr] = s.split(' ');
          const mIdx = MONTHS_ES.indexOf(mon);
          return parseInt(yr) * 12 + mIdx;
        };
        const cmp = parseGroup(a) - parseGroup(b);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else if (sortField === 'client') {
      entries.sort(([a], [b]) => {
        if (a === 'Sin cliente') return 1;
        if (b === 'Sin cliente') return -1;
        const cmp = a.localeCompare(b);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else {
      entries.sort(([a], [b]) => a.localeCompare(b));
    }

    return entries;
  }, [filtered, sortField, sortDir]);

  const toggleGroup = (letter: string) => {
    setCollapsedGroups(prev => {
      const n = new Set(prev); n.has(letter) ? n.delete(letter) : n.add(letter); return n;
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-4">
        <div>
          <h2 className="text-lg font-bold">Proyectos</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} proyecto{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'lista' && (
            <div className="flex items-center border rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('table')} className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`} title="Vista filas"><List className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('cards')} className={`p-2 transition-colors ${viewMode === 'cards' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`} title="Vista cards"><LayoutGrid className="w-4 h-4" /></button>
            </div>
          )}
          <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> Nuevo proyecto</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'lista' | 'timeline')}>
        <TabsList className="mb-5 h-9">
          <TabsTrigger value="lista" className="gap-1.5 text-sm">
            <List className="w-3.5 h-3.5" /> Lista
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5 text-sm">
            <GanttChartSquare className="w-3.5 h-3.5" /> Timeline General
          </TabsTrigger>
          <TabsTrigger value="calendario" className="gap-1.5 text-sm">
            <Calendar className="w-3.5 h-3.5" /> Calendario
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="mt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar..." className="pl-9 w-52 h-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {myProjectCount > 0 && (
              <div>
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Vista</div>
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border border-border/40">
                  <button
                    onClick={() => setScope('mine')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all ${scope === 'mine' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Mis proyectos
                    <span className={`text-[11px] rounded-full px-1.5 py-0 font-semibold leading-5 ${scope === 'mine' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
                      {myProjectCount}
                    </span>
                  </button>
                  <button
                    onClick={() => setScope('all')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all ${scope === 'all' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Todo Sapience
                    <span className={`text-[11px] rounded-full px-1.5 py-0 font-semibold leading-5 ${scope === 'all' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
                      {projects.length}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Estatus</div>
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border border-border/40">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all ${statusFilter === f.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {'dotClass' in f && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.dotClass}`} />}
                    {f.label}
                    <span className={`text-[11px] rounded-full px-1.5 py-0 font-semibold leading-5 ${statusFilter === f.key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
                      {countFor(f.key)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm">
                  {clientFilter === 'all' ? 'Todos los clientes' : clientFilter}
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <button
                  onClick={() => setClientFilter('all')}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors ${clientFilter === 'all' ? 'font-semibold text-primary' : ''}`}
                >
                  Todos los clientes
                </button>
                {uniqueClients.map(c => (
                  <button
                    key={c}
                    onClick={() => setClientFilter(c)}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors ${clientFilter === c ? 'font-semibold text-primary' : ''}`}
                  >
                    {c}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <div className="text-4xl mb-3">📂</div>
              <p className="font-medium">No hay proyectos</p>
              <p className="text-sm mt-1">{search ? 'Prueba con otro término de búsqueda' : 'Crea el primero con "Nuevo proyecto"'}</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className="bg-card border rounded-xl overflow-x-auto">
              <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: colWidths.reduce((a, b) => a + b, 0) }}>
                <colgroup>
                  {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border/50">
                    <ResizableTh colIdx={0} onResizeStart={onResizeStart} className="text-left px-4 py-2.5">
                      <SortToggle label="Nombre" field="name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    </ResizableTh>
                    <ResizableTh colIdx={1} onResizeStart={onResizeStart} className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Temática
                    </ResizableTh>
                    <ResizableTh colIdx={2} onResizeStart={onResizeStart} className="text-left px-4 py-2.5">
                      <SortToggle label="Cliente" field="client" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    </ResizableTh>
                    <ResizableTh colIdx={3} onResizeStart={onResizeStart} className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Estado
                    </ResizableTh>
                    <ResizableTh colIdx={4} onResizeStart={onResizeStart} className="text-left px-4 py-2.5">
                      <SortToggle label="Inicio" field="startDate" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    </ResizableTh>
                    <ResizableTh colIdx={5} onResizeStart={onResizeStart} className="text-left px-4 py-2.5">
                      <SortToggle label="Fin" field="endDate" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    </ResizableTh>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([letter, rows]) => {
                    const collapsed = collapsedGroups.has(letter);
                    return [
                      <tr key={`group-${letter}`} className="border-t border-border/30 first:border-t-0">
                        <td colSpan={7} className="px-0 py-0">
                          <button
                            onClick={() => toggleGroup(letter)}
                            className="w-full flex items-center gap-2 px-4 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                          >
                            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`} />
                            <span className="font-bold text-sm text-muted-foreground">{letter}</span>
                            <span className="text-xs text-muted-foreground/60 font-normal whitespace-nowrap flex-shrink-0">{rows.length} proyecto{rows.length !== 1 ? 's' : ''}</span>
                          </button>
                        </td>
                      </tr>,
                      ...(!collapsed ? rows.map(p => (
                        <ProjectRow
                          key={p.id}
                          p={p}
                          onOpen={() => navigate(`/operacion/proyectos/${p.projectCode}`)}
                          onEdit={() => openEdit(p)}
                          onDelete={() => setDeleting(p.id)}
                          onSaveField={saveField}
                          onOpenTeams={() => openTeamsDialog(p)}
                        />
                      )) : []),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(([letter, rows]) => (
                <div key={letter}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-bold text-muted-foreground text-sm w-5">{letter}</span>
                    <div className="flex-1 border-t border-border/40" />
                    <span className="text-xs text-muted-foreground/50">{rows.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {rows.map(p => (
                      <ProjectCard key={p.id} p={p} onOpen={() => navigate(`/operacion/proyectos/${p.projectCode}`)} onEdit={() => openEdit(p)} onDelete={() => setDeleting(p.id)} onOpenTeams={() => openTeamsDialog(p)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-0">
          <GanttTimeline />
        </TabsContent>

        <TabsContent value="calendario" className="mt-0">
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  Proyectos
                  {calProjFilter.size > 0 && <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0 text-[10px] leading-4">{calProjFilter.size}</span>}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                {calProjectCodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-1">Sin proyectos en esta semana</p>
                ) : calProjectCodes.map(code => (
                  <button
                    key={code}
                    onClick={() => setCalProjFilter(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; })}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-left hover:bg-muted transition-colors ${calProjFilter.has(code) ? 'text-primary font-semibold' : ''}`}
                  >
                    <span className={`w-3 h-3 rounded-sm border-2 flex items-center justify-center flex-shrink-0 ${calProjFilter.has(code) ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                      {calProjFilter.has(code) && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                    </span>
                    {code}
                  </button>
                ))}
                {calProjFilter.size > 0 && (
                  <Button variant="ghost" size="sm" className="w-full mt-1 h-7 text-xs text-muted-foreground" onClick={() => setCalProjFilter(new Set())}>
                    Limpiar
                  </Button>
                )}
              </PopoverContent>
            </Popover>

            <Select value={calLocFilter || '__all__'} onValueChange={v => setCalLocFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todos los espacios" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos los espacios</SelectItem>
                {calLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>

            {calLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Project color legend */}
          {calProjectCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {calProjectCodes.map(code => {
                const cv = getProjectColorVar(code);
                const active = calProjFilter.size === 0 || calProjFilter.has(code);
                return (
                  <button
                    key={code}
                    onClick={() => setCalProjFilter(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; })}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity ${active ? '' : 'opacity-35'}`}
                    style={{ borderColor: `hsl(var(${cv}))`, color: `hsl(var(${cv}))`, background: `hsl(var(${cv}) / 0.1)` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: `hsl(var(${cv}))` }} />
                    {code}
                  </button>
                );
              })}
            </div>
          )}

          <WeeklyCalendar
            events={filteredCalEvents}
            onEventUpdate={handleCalEvtUpdate}
            onEventClick={openCalEvt}
            onWeekChange={loadCalEvents}
            onEventResize={async (id, newDurationHours) => {
              setCalEvents(prev => prev.map(e => e.id === id ? { ...e, durationHours: newDurationHours } : e));
              try {
                await saveCalendarEvent({ id, durationHours: newDurationHours });
              } catch {
                toast.error('Error al cambiar la duración');
              }
            }}
          />

          {/* Event detail / edit dialog */}
          <Dialog open={calEvtOpen} onOpenChange={v => { setCalEvtOpen(v); if (!v) setCalEvtEdit(false); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-4 flex-wrap">
                  <span className="truncate">{selCalEvent?.eventName}</span>
                  {selCalEvent?.projectCode && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `hsl(var(${getProjectColorVar(selCalEvent.projectCode)}) / 0.15)`, color: `hsl(var(${getProjectColorVar(selCalEvent.projectCode)}))` }}>
                      {selCalEvent.projectCode}
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>

              {!calEvtEdit ? (
                <div className="space-y-2.5 py-1">
                  {selCalEvent?.eventDate && (
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span>{new Date(selCalEvent.eventDate).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {!!selCalEvent?.durationHours && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span>{selCalEvent.durationHours}h de duración</span>
                    </div>
                  )}
                  {selCalEvent?.location && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span>{selCalEvent.location}</span>
                    </div>
                  )}
                  {selCalEvent?.attendees && (
                    <div className="flex items-start gap-2 text-sm">
                      <Users className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <span>{selCalEvent.attendees}</span>
                    </div>
                  )}
                  {selCalEvent?.inviteEmails && (
                    <div className="flex items-start gap-2 text-sm">
                      <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-muted-foreground break-all">{selCalEvent.inviteEmails}</span>
                    </div>
                  )}
                  {selCalEvent?.notes && (
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">{selCalEvent.notes}</div>
                  )}

                  {/* ── Outlook sync section ── */}
                  <div className="border-t border-border/40 pt-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">Outlook</span>
                        {selCalEvent?.inviteStatus && (() => {
                          const statusColors: Record<string, string> = {
                            'Enviado': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                            'Por actualizar': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                            'Por crear': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                            'Por cancelar': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                            'Cancelado': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                          };
                          const cls = statusColors[selCalEvent.inviteStatus] ?? 'bg-muted text-muted-foreground';
                          return (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
                              {selCalEvent.inviteStatus}
                            </span>
                          );
                        })()}
                      </div>
                      {selCalEvent?.inviteBodyHtml && (
                        <button
                          onClick={() => setHtmlPreviewOpen(true)}
                          className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> Vista previa
                        </button>
                      )}
                      {selCalEvent?.outlookEventLink && (
                        <a
                          href={selCalEvent.outlookEventLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" /> Ver en Outlook
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5 flex-1"
                        onClick={() => handleOutlookSync(selCalEvent?.outlookEventId ? 'update' : 'create')}
                        disabled={outlookSyncing}
                      >
                        {outlookSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        {selCalEvent?.outlookEventId ? 'Actualizar invitación' : 'Crear invitación'}
                      </Button>
                      {selCalEvent?.outlookEventId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleOutlookSync('cancel')}
                          disabled={outlookSyncing}
                        >
                          <X className="w-3 h-3" /> Cancelar invitación
                        </Button>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="mt-2">
                    <Button variant="outline" size="sm" onClick={() => setCalEvtOpen(false)}>Cerrar</Button>
                    <Button size="sm" onClick={startCalEvtEdit}>Editar</Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-3 py-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Fecha y hora</Label>
                      <Input type="datetime-local" value={calEvtForm.eventDate} onChange={e => setCalEvtForm(f => ({ ...f, eventDate: e.target.value }))} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Duración (horas)</Label>
                      <Input type="number" min="0.25" step="0.25" value={calEvtForm.durationHours} onChange={e => setCalEvtForm(f => ({ ...f, durationHours: parseFloat(e.target.value) || 1 }))} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Moderador</Label>
                      <Input placeholder="Ej: Ana..." value={calEvtForm.attendees} onChange={e => setCalEvtForm(f => ({ ...f, attendees: e.target.value }))} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Emails asistentes</Label>
                      <Input placeholder="correo1@mail.com, correo2@mail.com..." value={calEvtForm.inviteEmails} onChange={e => setCalEvtForm(f => ({ ...f, inviteEmails: e.target.value }))} className="text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Ubicación Interna</Label>
                      <Select
                        value={calEvtForm.locCustom ? 'otro' : (calEvtForm.location || undefined)}
                        onValueChange={v => { if (v === 'otro') setCalEvtForm(f => ({ ...f, locCustom: true, location: '' })); else setCalEvtForm(f => ({ ...f, locCustom: false, location: v })); }}
                      >
                        <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar espacio..." /></SelectTrigger>
                        <SelectContent>
                          {PRESET_LOCS_CAL.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                          <SelectItem value="otro">✏️ Otro (escribir)</SelectItem>
                        </SelectContent>
                      </Select>
                      {calEvtForm.locCustom && <Input className="mt-1.5 text-sm" placeholder="Escribe el lugar..." value={calEvtForm.location} onChange={e => setCalEvtForm(f => ({ ...f, location: e.target.value }))} />}
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Notas / Link de conexión</Label>
                      <Textarea rows={3} placeholder="Link de Zoom, instrucciones, notas..." value={calEvtForm.notes} onChange={e => setCalEvtForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => setCalEvtEdit(false)}>Cancelar</Button>
                    <Button size="sm" onClick={saveCalEvt} disabled={calEvtSaving}>{calEvtSaving ? 'Guardando...' : 'Guardar'}</Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>

      {/* Form Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="col-span-2 space-y-1">
              <Label>Nombre *</Label>
              <Input placeholder="PLAYITA-2025" value={form.projectCode} onChange={e => setForm(f => ({ ...f, projectCode: e.target.value.toUpperCase() }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Temática</Label>
              <Input placeholder="Ej. Focus group sobre hábitos de consumo" value={form.tematica} onChange={e => setForm(f => ({ ...f, tematica: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Cliente</Label>
              <ComboboxCreatable
                value={form.client}
                onChange={v => setForm(f => ({ ...f, client: v }))}
                options={uniqueClients}
                placeholder="Empresa S.A."
              />
            </div>
            <div className="space-y-1">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fecha inicio</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Fecha fin</Label>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Descripción</Label>
              <Textarea placeholder="Descripción del proyecto..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            {users.length > 0 && (
              <div className="col-span-2 space-y-3 pt-1 border-t border-border/40">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Equipo</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <TeamMemberPicker
                      users={users}
                      selected={form.lider}
                      onChange={ids => setForm(f => ({ ...f, lider: ids.slice(0, 1) }))}
                      label="Líder"
                      multiple={false}
                      placeholder="Seleccionar líder..."
                    />
                  </div>
                  <TeamMemberPicker
                    users={users}
                    selected={form.analistas}
                    onChange={ids => setForm(f => ({ ...f, analistas: ids }))}
                    label="Analistas"
                    placeholder="Agregar analistas..."
                  />
                  <TeamMemberPicker
                    users={users}
                    selected={form.moderadores}
                    onChange={ids => setForm(f => ({ ...f, moderadores: ids }))}
                    label="Moderadores"
                    placeholder="Agregar moderadores..."
                  />
                  <div className="col-span-2">
                    <TeamMemberPicker
                      users={users}
                      selected={form.asistentes}
                      onChange={ids => setForm(f => ({ ...f, asistentes: ids }))}
                      label="Asistentes"
                      placeholder="Agregar asistentes..."
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HTML invite preview dialog ── */}
      <Dialog open={htmlPreviewOpen} onOpenChange={setHtmlPreviewOpen}>
        <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
            <DialogTitle className="text-sm font-semibold">Vista previa del email — {selCalEvent?.eventName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {selCalEvent?.inviteBodyHtml ? (
              <iframe
                srcDoc={selCalEvent.inviteBodyHtml}
                className="w-full h-full border-0"
                title="Vista previa del email de Outlook"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Sin contenido HTML disponible
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TeamsChannelDialog
        open={teamsDialogOpen}
        onOpenChange={setTeamsDialogOpen}
        project={teamsDialogProject}
        onSuccess={load}
      />

      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar proyecto?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={del} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
