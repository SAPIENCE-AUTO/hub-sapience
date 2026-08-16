import { useEffect, useState } from 'react';
import { Users, CalendarDays, BarChart2, DollarSign, FileText, MessageSquare, Folder } from 'lucide-react';
import { getRecruitmentSummary, getTasks, getProjectTeamsFiles, getMessages } from 'zite-endpoints-sdk';
import { computeGanttSegments, GanttData } from './ganttMath';

type PmSection = 'timelines' | 'calendarios';

interface ProjectHubLandingProps {
  projectCode: string;
  canSeeBudget: boolean;
  onOpenTab: (tab: 'reclutamiento' | 'presupuesto' | 'documentos' | 'chat') => void;
  onOpenActividades: (section: PmSection) => void;
}

type RecruitmentBoardSummary = { boardName: string; totalParticipants: number; groups: { name: string; count: number }[] };
type RecruitmentSummary = { totalParticipants: number; boards: RecruitmentBoardSummary[] };
type EventItem = { id: string; eventName?: string; eventDate?: string };
type FolderItem = { name: string; count: number };
type MessageItem = { senderName?: string; senderEmail?: string; content?: string };

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(iso));
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function cleanPreview(text: string): string {
  const stripped = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`#]/g, '').trim();
  return (stripped || '📎 Archivo').slice(0, 70);
}

// El campo `status` casi nunca se llena en la práctica (confirmado en vivo:
// 0 de 15 fases de FRESH lo tenían) — se usa como respaldo la fecha real de
// la fase contra "hoy", que siempre está disponible.
function statusColorClass(seg: { status?: string; startDate: string; endDate: string }, nowMs: number): string {
  if (seg.status === 'Completada') return 'bg-chart-1';
  if (seg.status === 'En progreso') return 'bg-primary';
  if (seg.status === 'Pendiente' || seg.status === 'Bloqueada') return 'bg-muted-foreground/30';

  const endMs = new Date(seg.endDate).getTime();
  const startMs = new Date(seg.startDate).getTime();
  if (endMs < nowMs) return 'bg-chart-1';
  if (startMs <= nowMs && nowMs <= endMs) return 'bg-primary';
  return 'bg-muted-foreground/30';
}

export function ProjectHubLanding({ projectCode, canSeeBudget, onOpenTab, onOpenActividades }: ProjectHubLandingProps) {
  const [recruitment, setRecruitment] = useState<RecruitmentSummary | null>(null);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [gantt, setGantt] = useState<GanttData | null | undefined>(undefined);
  const [folders, setFolders] = useState<FolderItem[] | null>(null);
  const [teamsLinked, setTeamsLinked] = useState(true);
  const [messages, setMessages] = useState<MessageItem[] | null>(null);

  useEffect(() => {
    setRecruitment(null); setEvents(null); setGantt(undefined); setFolders(null); setMessages(null);

    getRecruitmentSummary({ projectCode }).then(setRecruitment).catch(() => setRecruitment({ totalParticipants: 0, boards: [] }));

    getTasks({ projectCode, only: 'events' }).then(d => {
      const sorted = [...(d.calendarEvents ?? [])].sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''));
      setEvents(sorted);
    }).catch(() => setEvents([]));

    getTasks({ projectCode, only: 'tasks' }).then(d => {
      const phases = (d.tasks ?? [])
        .filter((t: any) => !t.parentTaskId)
        .map((t: any) => ({ name: t.taskName ?? 'Sin nombre', status: t.status, startDate: t.startDate, endDate: t.endDate }));
      setGantt(computeGanttSegments(phases));
    }).catch(() => setGantt(null));

    getProjectTeamsFiles({ projectCode }).then(d => {
      setTeamsLinked(!!d.linked);
      setFolders((d.folders ?? []).map((f: any) => ({ name: f.name, count: f.files?.length ?? 0 })));
    }).catch(() => { setTeamsLinked(false); setFolders([]); });

    getMessages({ channel: projectCode, limit: 3 }).then(d => setMessages(d.messages ?? [])).catch(() => setMessages([]));
  }, [projectCode]);

  const now = Date.now();

  return (
    <div className="p-6 overflow-y-auto h-full">
      <p className="text-sm text-muted-foreground mb-4">¿A dónde quieres ir?</p>

      <div className="flex flex-col gap-3 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ── Reclutamiento ── */}
          <div onClick={() => onOpenTab('reclutamiento')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 bg-chart-5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-0.5">
                <div className="w-[26px] h-[26px] rounded-lg bg-chart-5/10 text-chart-5 flex items-center justify-center flex-shrink-0"><Users className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Reclutamiento</span>
              </div>
              {recruitment ? (
                <div className="flex items-baseline gap-1.5 px-3.5 pt-1.5 pb-2">
                  <span className="text-xl font-medium text-chart-5">{recruitment.totalParticipants}</span>
                  <span className="text-xs text-muted-foreground">
                    participantes · {recruitment.boards.reduce((n, b) => n + b.groups.length, 0)} grupos
                    {recruitment.boards.length > 1 ? ` · ${recruitment.boards.length} tableros` : ''}
                  </span>
                </div>
              ) : (
                <div className="h-8" />
              )}
              {recruitment && recruitment.boards.length > 0 && (
                <div className="border-t border-border max-h-[150px] overflow-y-auto px-3.5 pb-1">
                  {recruitment.boards.map((board, bi) => (
                    <div key={`${board.boardName}-${bi}`}>
                      <p className="text-[11px] font-medium text-foreground pt-2 pb-0.5 truncate">{board.boardName} · {board.totalParticipants}</p>
                      {board.groups.map((g, gi) => (
                        <div key={`${g.name}-${gi}`} className="flex justify-between gap-2 py-1 text-xs border-b border-border last:border-b-0">
                          <span className="truncate text-muted-foreground pl-2">{g.name}</span>
                          <span className="text-foreground flex-shrink-0">{g.count}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {recruitment && recruitment.boards.length === 0 && <p className="px-3.5 pb-3 text-xs text-muted-foreground">Sin tableros de reclutamiento</p>}
            </div>
          </div>

          {/* ── Calendario ── */}
          <div onClick={() => onOpenActividades('calendarios')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 bg-chart-1 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-0.5">
                <div className="w-[26px] h-[26px] rounded-lg bg-chart-1/10 text-chart-1 flex items-center justify-center flex-shrink-0"><CalendarDays className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Calendario</span>
              </div>
              {events ? (
                <div className="flex items-baseline gap-1.5 px-3.5 pt-1.5 pb-2">
                  <span className="text-xl font-medium text-chart-1">{events.length}</span>
                  <span className="text-xs text-muted-foreground">sesiones</span>
                </div>
              ) : (
                <div className="h-8" />
              )}
              {events && events.length > 0 && (
                <div className="border-t border-border max-h-[150px] overflow-y-auto px-3.5">
                  {events.map(ev => {
                    const isPast = ev.eventDate ? new Date(ev.eventDate).getTime() < now : false;
                    return (
                      <div key={ev.id} className={`flex justify-between gap-2 py-1.5 text-xs border-b border-border last:border-b-0 ${isPast ? 'opacity-50' : ''}`}>
                        <span className="truncate text-foreground">{ev.eventName || 'Sin nombre'}</span>
                        <span className="text-muted-foreground flex-shrink-0">{ev.eventDate ? fmtDateTime(ev.eventDate) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {events && events.length === 0 && <p className="px-3.5 pb-3 text-xs text-muted-foreground">Sin sesiones registradas</p>}
            </div>
          </div>
        </div>

        {/* ── Timelines (franja ancha) ── */}
        <div onClick={() => onOpenActividades('timelines')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
          <div className="w-1 bg-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
              <div className="w-[26px] h-[26px] rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><BarChart2 className="w-3.5 h-3.5" /></div>
              <span className="text-sm font-medium text-foreground">Timelines</span>
              {gantt && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtDate(gantt.rangeStart.toISOString())} — {fmtDate(gantt.rangeEnd.toISOString())} · {gantt.segments.length} fases
                </span>
              )}
            </div>
            {gantt === undefined && <div className="h-16" />}
            {gantt === null && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Aún no hay fechas cargadas en el timeline</p>}
            {gantt && (
              <div className="px-3.5 pb-3.5 pt-1.5 flex flex-col gap-2 max-h-[180px] overflow-y-auto">
                {gantt.segments.map((seg, i) => (
                  <div key={`${seg.name}-${i}`} className="flex items-center gap-2.5">
                    <span className="text-xs text-muted-foreground w-28 flex-shrink-0 truncate">{seg.name}</span>
                    <div className="relative flex-1 h-2 rounded-full bg-muted">
                      <div className={`absolute top-0 h-2 rounded-full ${statusColorClass(seg, now)}`} style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* ── Presupuesto ── */}
          {canSeeBudget && (
            <div onClick={() => onOpenTab('presupuesto')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
              <div className="w-1 bg-chart-4 flex-shrink-0" />
              <div className="flex-1 flex items-center gap-2.5 px-3.5 py-3">
                <div className="w-[26px] h-[26px] rounded-lg bg-chart-4/10 text-chart-4 flex items-center justify-center flex-shrink-0"><DollarSign className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Presupuesto</span>
                <span className="ml-auto text-xs text-muted-foreground">Ver detalle</span>
              </div>
            </div>
          )}

          {/* ── Documentos ── */}
          <div onClick={() => onOpenTab('documentos')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 bg-chart-2 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
                <div className="w-[26px] h-[26px] rounded-lg bg-chart-2/10 text-chart-2 flex items-center justify-center flex-shrink-0"><FileText className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Documentos</span>
              </div>
              {!teamsLinked && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Sin carpetas vinculadas</p>}
              {teamsLinked && folders && folders.length === 0 && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Sin archivos aún</p>}
              {teamsLinked && folders && folders.length > 0 && (
                <div className="flex flex-wrap gap-4 px-3.5 pb-3.5 pt-1">
                  {folders.slice(0, 6).map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex flex-col items-center gap-1 w-14">
                      <Folder className="w-6 h-6 text-chart-2" />
                      <span className="text-[11px] text-foreground text-center leading-tight truncate w-full">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground">{f.count} arch.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Chat ── */}
          <div onClick={() => onOpenTab('chat')} className="flex rounded-xl border border-border bg-card hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 bg-chart-3 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
                <div className="w-[26px] h-[26px] rounded-lg bg-chart-3/10 text-chart-3 flex items-center justify-center flex-shrink-0"><MessageSquare className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Chat</span>
              </div>
              {messages && messages.length === 0 && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Sin mensajes aún</p>}
              {messages && messages.length > 0 && (
                <div className="px-3.5 pb-3 pt-1 max-h-[100px] overflow-y-auto">
                  {messages.map((m, i) => (
                    <p key={i} className="text-xs py-1 border-b border-border last:border-b-0">
                      <span className="font-medium text-foreground">{m.senderName || m.senderEmail?.split('@')[0] || 'Alguien'}: </span>
                      <span className="text-muted-foreground">{cleanPreview(m.content ?? '')}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
