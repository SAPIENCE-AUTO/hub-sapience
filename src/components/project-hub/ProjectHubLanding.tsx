import { useEffect, useState, type ReactNode } from 'react';
import { Users, CalendarDays, BarChart2, DollarSign, FileText, MessageSquare, Folder, Wrench } from 'lucide-react';
import { getRecruitmentSummary, getTasks, getProjectTeamsFiles, getMessages, getSwipeSesiones } from 'zite-endpoints-sdk';
import { computeGanttSegments, GanttData } from './ganttMath';
import { TEAL, TEAL_2, GOLD, INFO, EXITO, NEUTRAL, ALERTA, EstadoPill } from '../swipe/swipeColors';

// Paleta de acento por tarjeta — mismos 6 tonos del sistema decidido en el
// moodboard del Hub, sin inventar hues nuevos. El desglose de Reclutamiento
// por tablero rota sobre este mismo arreglo.
const ACCENT_PALETTE = [TEAL, GOLD, INFO, EXITO, NEUTRAL, TEAL_2];

// Header sólido con ícono + etiqueta en blanco (o tinta oscura sobre gold,
// que es demasiado claro para texto blanco) — la identidad de color de cada
// tarjeta vive aquí, no en un ícono con tinte chiquito.
function ColorHead({ color, ink, icon, label }: { color: string; ink?: string; icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: color, color: ink ?? '#fff' }}>
      {icon}
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  );
}

type PmSection = 'timelines' | 'calendarios';

interface ProjectHubLandingProps {
  projectCode: string;
  projectId?: string;
  canSeeBudget: boolean;
  canSeeTools: boolean;
  onOpenTab: (tab: 'reclutamiento' | 'presupuesto' | 'documentos' | 'chat' | 'tools') => void;
  onOpenActividades: (section: PmSection) => void;
}

type SwipeSesionItem = { id: string; nombre: string; estado: string };

type RecruitmentBoardSummary = { boardName: string; totalParticipants: number; groups: { name: string; count: number }[] };
type RecruitmentSummary = { totalParticipants: number; boards: RecruitmentBoardSummary[] };
type EventItem = { id: string; eventName?: string; eventDate?: string };
type FolderItem = { name: string; count: number };
type MessageItem = { senderName?: string; senderEmail?: string; content?: string };

// timeZone: 'UTC' es a propósito — startDate/endDate son fechas de calendario
// puras ("2026-05-12"), no un momento con hora. Sin esto, Intl.DateTimeFormat
// las interpreta como medianoche UTC y las muestra en la zona local del
// navegador, recorriéndolas un día hacia atrás en cualquier huso al oeste de
// UTC (confirmado en vivo: "2026-05-12" se mostraba como "11 may" en México).
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const fmtRange = (startIso: string, endIso: string) =>
  startIso === endIso ? fmtDate(startIso) : `${fmtDate(startIso)} – ${fmtDate(endIso)}`;

function cleanPreview(text: string): string {
  const stripped = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`#]/g, '').trim();
  return (stripped || '📎 Archivo').slice(0, 70);
}

// El campo `status` casi nunca se llena en la práctica (confirmado en vivo:
// 0 de 15 fases de FRESH lo tenían) — se usa como respaldo la fecha real de
// la fase contra "hoy", que siempre está disponible. Mismo criterio de
// siempre (completada/en curso/pendiente), solo cambia a qué color hex
// mapea cada estado.
// null = pendiente — se pinta con el token de tema (bg-muted-foreground/30)
// en vez de un hex fijo, para que le siga funcionando el modo oscuro si el
// Hub lo llega a tener; completada/en curso sí son colores de marca fijos,
// igual que el resto de esta paleta.
function statusColor(seg: { status?: string; startDate: string; endDate: string }, nowMs: number): string | null {
  if (seg.status === 'Completada') return EXITO;
  if (seg.status === 'En progreso') return INFO;
  if (seg.status === 'Pendiente' || seg.status === 'Bloqueada') return null;

  const endMs = new Date(seg.endDate).getTime();
  const startMs = new Date(seg.startDate).getTime();
  if (endMs < nowMs) return EXITO;
  if (startMs <= nowMs && nowMs <= endMs) return INFO;
  return null;
}

export function ProjectHubLanding({ projectCode, projectId, canSeeBudget, canSeeTools, onOpenTab, onOpenActividades }: ProjectHubLandingProps) {
  const [recruitment, setRecruitment] = useState<RecruitmentSummary | null>(null);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [gantt, setGantt] = useState<GanttData | null | undefined>(undefined);
  const [folders, setFolders] = useState<FolderItem[] | null>(null);
  const [teamsLinked, setTeamsLinked] = useState(true);
  const [messages, setMessages] = useState<MessageItem[] | null>(null);
  const [swipeSesiones, setSwipeSesiones] = useState<SwipeSesionItem[] | null>(null);

  useEffect(() => {
    setRecruitment(null); setEvents(null); setGantt(undefined); setFolders(null); setMessages(null); setSwipeSesiones(null);

    if (canSeeTools && projectId) {
      getSwipeSesiones({ proyectoId: projectId }).then((d) => setSwipeSesiones(d.sesiones ?? [])).catch(() => setSwipeSesiones([]));
    }

    getRecruitmentSummary({ projectCode }).then(setRecruitment).catch(() => setRecruitment({ totalParticipants: 0, boards: [] }));

    getTasks({ projectCode, only: 'events' }).then(d => {
      // El widget del home es un resumen de "qué sigue" — las sesiones
      // marcadas "[ARCHIVED]" (convención manual del equipo, no un campo del
      // schema) siguen viviendo en Calendario/Actividades para historial,
      // pero aquí solo confunden ("52 sesiones" contando cosas archivadas).
      const sorted = [...(d.calendarEvents ?? [])]
        .filter(e => !/^\s*\[archived\]/i.test(e.eventName ?? ''))
        .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''));
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
  }, [projectCode, projectId, canSeeTools]);

  const now = Date.now();

  // Líneas verticales de inicio de semana (lunes) dentro del rango del
  // Gantt — en UTC para no repetir el corrimiento de un día que ya se
  // encontró en fmtDate (startDate/endDate son fechas de calendario puras).
  const weekTicks = gantt ? (() => {
    const ticks: { pct: number; label: string }[] = [];
    const startMs = gantt.rangeStart.getTime(), endMs = gantt.rangeEnd.getTime(), span = endMs - startMs;
    if (span <= 0) return ticks;
    const cur = new Date(startMs);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur.getUTCDay() !== 1) cur.setUTCDate(cur.getUTCDate() - 1);
    while (cur.getTime() <= endMs) {
      if (cur.getTime() >= startMs) ticks.push({ pct: (cur.getTime() - startMs) / span * 100, label: fmtDate(cur.toISOString()) });
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    return ticks;
  })() : [];

  // "Hoy" dentro del rango del Gantt — mismo `now` que ya alimenta
  // statusColor, solo se ubica en la misma escala 0-100% que las barras.
  const todayPct = gantt
    ? (() => {
        const startMs = gantt.rangeStart.getTime(), endMs = gantt.rangeEnd.getTime(), span = endMs - startMs;
        if (span <= 0 || now < startMs || now > endMs) return null;
        return (now - startMs) / span * 100;
      })()
    : null;

  return (
    <div className="p-6 overflow-y-auto h-full">
      <p className="text-sm text-muted-foreground mb-4">¿A dónde quieres ir?</p>

      <div className="flex flex-col gap-3 max-w-5xl">
        {/* ── Timelines: hero — la pieza que más se consulta en junta, va primero y más grande ── */}
        <div
          onClick={() => onOpenActividades('timelines')}
          className="cursor-pointer overflow-hidden rounded-xl"
          style={{ backgroundColor: TEAL_2 }}
        >
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-white/15"><BarChart2 className="w-3.5 h-3.5" style={{ color: GOLD }} /></div>
            <span className="text-sm font-semibold text-white">Timelines</span>
            {gantt && (
              <span className="ml-auto text-xs text-white/60 font-mono">
                {fmtDate(gantt.rangeStart.toISOString())} — {fmtDate(gantt.rangeEnd.toISOString())} · {gantt.segments.length} fases
              </span>
            )}
          </div>
          {gantt === undefined && <div className="h-16" />}
          {gantt === null && <p className="px-4 pb-3 pt-1 text-xs text-white/60">Aún no hay fechas cargadas en el timeline</p>}
          {gantt && (
            <div className="px-4 pb-3 pt-1">
              {/* Regla: inicio de cada semana (lunes), alineada con las líneas verticales de cada fila */}
              <div className="flex items-center gap-3 mb-1">
                <div className="w-36 flex-shrink-0" />
                <div className="relative flex-1 h-3">
                  {weekTicks.map((t, i) => (
                    <span key={i} className="absolute text-[10px] text-white/50 whitespace-nowrap font-mono"
                      style={{ left: `${t.pct}%`, transform: t.pct > 90 ? 'translateX(-100%)' : t.pct < 2 ? 'none' : 'translateX(-50%)' }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                {gantt.segments.map((seg, i) => {
                  const color = statusColor(seg, now);
                  return (
                    <div key={`${seg.name}-${i}`} className="flex items-center gap-3">
                      <p className="w-36 flex-shrink-0 text-[12px] text-white truncate" title={seg.name}>
                        {seg.name} <span className="text-white/40 font-mono text-[10px]">· {fmtRange(seg.startDate, seg.endDate)}</span>
                      </p>
                      <div className="relative flex-1 h-4">
                        {weekTicks.map((t, i2) => (
                          <div key={i2} className="absolute top-0 bottom-0 w-px bg-white/10" style={{ left: `${t.pct}%` }} />
                        ))}
                        {todayPct !== null && (
                          <div className="absolute top-0 bottom-0 w-px border-l border-dashed z-10" style={{ left: `${todayPct}%`, borderColor: GOLD }} />
                        )}
                        <div className="absolute top-1/2 -translate-y-1/2 h-2 w-full rounded-full bg-white/10" />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full"
                          style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%`, backgroundColor: color ?? 'rgba(255,255,255,.25)' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ── Reclutamiento ── */}
          <div onClick={() => onOpenTab('reclutamiento')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="px-3.5 py-2.5" style={{ backgroundColor: TEAL }}>
              <div className="flex items-center gap-2">
                <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center flex-shrink-0 bg-white/20"><Users className="w-3 h-3 text-white" /></div>
                <span className="text-sm font-medium text-white">Reclutamiento</span>
                {recruitment && <span className="ml-auto text-xl font-semibold font-mono leading-none text-white">{recruitment.totalParticipants}</span>}
              </div>
              {recruitment && (
                <p className="text-[11px] text-white/70 mt-1">
                  participantes · {recruitment.boards.reduce((n, b) => n + b.groups.length, 0)} grupos
                  {recruitment.boards.length > 1 ? ` · ${recruitment.boards.length} tableros` : ''}
                </p>
              )}
            </div>
            {recruitment && recruitment.boards.length > 1 && (
              <div className="px-3.5 pt-3">
                <div className="flex h-1.5 rounded-full overflow-hidden">
                  {recruitment.boards.map((board, bi) => (
                    <div
                      key={`${board.boardName}-bar-${bi}`}
                      style={{
                        width: `${(board.totalParticipants / Math.max(recruitment.totalParticipants, 1)) * 100}%`,
                        backgroundColor: ACCENT_PALETTE[bi % ACCENT_PALETTE.length],
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {recruitment && recruitment.boards.length > 0 && (
              <div className="max-h-[150px] overflow-y-auto px-3.5 pt-2 pb-1">
                {recruitment.boards.map((board, bi) => (
                  <div key={`${board.boardName}-${bi}`}>
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground pt-2 pb-0.5 truncate">
                      {recruitment.boards.length > 1 && (
                        <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ backgroundColor: ACCENT_PALETTE[bi % ACCENT_PALETTE.length] }} />
                      )}
                      {board.boardName} · {board.totalParticipants}
                    </p>
                    {board.groups.map((g, gi) => (
                      <div key={`${g.name}-${gi}`} className="flex justify-between gap-2 py-1 text-xs border-b border-border last:border-b-0">
                        <span className="truncate text-muted-foreground pl-2">{g.name}</span>
                        <span className="text-foreground font-mono flex-shrink-0">{g.count}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {recruitment && recruitment.boards.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">Sin tableros de reclutamiento</p>}
          </div>

          {/* ── Calendario ── */}
          <div onClick={() => onOpenActividades('calendarios')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="px-3.5 py-2.5" style={{ backgroundColor: INFO }}>
              <div className="flex items-center gap-2">
                <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center flex-shrink-0 bg-white/20"><CalendarDays className="w-3 h-3 text-white" /></div>
                <span className="text-sm font-medium text-white">Calendario</span>
                {events && <span className="ml-auto text-xl font-semibold font-mono leading-none text-white">{events.length}</span>}
              </div>
              {events && <p className="text-[11px] text-white/70 mt-1">sesiones</p>}
            </div>
            {events && events.length > 0 && (
              <div className="max-h-[150px] overflow-y-auto px-3.5">
                {events.map(ev => {
                  const isPast = ev.eventDate ? new Date(ev.eventDate).getTime() < now : false;
                  return (
                    <div key={ev.id} className={`flex justify-between gap-2 py-1.5 text-xs border-b border-border last:border-b-0 ${isPast ? 'opacity-50' : ''}`}>
                      <span className="truncate text-foreground">{ev.eventName || 'Sin nombre'}</span>
                      <span className="text-muted-foreground flex-shrink-0 font-mono">{ev.eventDate ? fmtDateTime(ev.eventDate) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {events && events.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">Sin sesiones registradas</p>}
          </div>
        </div>

        {/* ── Tools / Presupuesto / Documentos / Chat — un color distinto cada una ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {canSeeTools && (
            <div onClick={() => onOpenTab('tools')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
              <ColorHead color={EXITO} icon={<Wrench className="w-3.5 h-3.5" />} label="Tools" />
              <div className="px-3.5 py-3">
                {!swipeSesiones && <div className="h-4" />}
                {swipeSesiones && swipeSesiones.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin sesiones de Swipe todavía — ábrelo para crear la primera.</p>
                )}
                {swipeSesiones && swipeSesiones.length > 0 && (
                  <div className="space-y-1">
                    {swipeSesiones.slice(0, 3).map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-foreground">{s.nombre}</span>
                        <EstadoPill estado={s.estado} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Presupuesto ── */}
          {canSeeBudget && (
            <div onClick={() => onOpenTab('presupuesto')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
              <ColorHead color={GOLD} ink="#412402" icon={<DollarSign className="w-3.5 h-3.5" />} label="Presupuesto" />
              <div className="px-3.5 py-3">
                <span className="text-xs text-muted-foreground">Ver detalle</span>
              </div>
            </div>
          )}

          {/* ── Documentos ── */}
          <div onClick={() => onOpenTab('documentos')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <ColorHead color={NEUTRAL} icon={<FileText className="w-3.5 h-3.5" />} label="Documentos" />
            <div className="px-3.5 py-3">
              {!teamsLinked && <p className="text-xs text-muted-foreground">Sin carpetas vinculadas</p>}
              {teamsLinked && folders && folders.length === 0 && <p className="text-xs text-muted-foreground">Sin archivos aún</p>}
              {teamsLinked && folders && folders.length > 0 && (
                <div className="flex flex-wrap gap-4">
                  {folders.slice(0, 6).map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex flex-col items-center gap-1 w-14">
                      <Folder className="w-6 h-6" style={{ color: NEUTRAL }} />
                      <span className="text-[11px] text-foreground text-center leading-tight truncate w-full">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{f.count} arch.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Chat ── */}
          <div onClick={() => onOpenTab('chat')} className="rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <ColorHead color={ALERTA} icon={<MessageSquare className="w-3.5 h-3.5" />} label="Chat" />
            <div className="px-3.5 py-3">
              {messages && messages.length === 0 && <p className="text-xs text-muted-foreground">Sin mensajes aún</p>}
              {messages && messages.length > 0 && (
                <div className="max-h-[100px] overflow-y-auto">
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
