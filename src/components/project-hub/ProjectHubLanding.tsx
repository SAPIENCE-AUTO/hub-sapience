import { useEffect, useState } from 'react';
import { Users, CalendarDays, BarChart2, DollarSign, FileText, MessageSquare, Folder, Wrench } from 'lucide-react';
import { getRecruitmentSummary, getTasks, getProjectTeamsFiles, getMessages, getSwipeSesiones } from 'zite-endpoints-sdk';
import { computeGanttSegments, GanttData } from './ganttMath';
import { TEAL, TEAL_2, GOLD, INFO, EXITO, NEUTRAL, EstadoPill } from '../swipe/swipeColors';

// Paleta de acento por tarjeta — mismos 6 tonos del sistema decidido en el
// moodboard del Hub, sin inventar hues nuevos. El desglose de Reclutamiento
// por tablero rota sobre este mismo arreglo.
const ACCENT_PALETTE = [TEAL, GOLD, INFO, EXITO, NEUTRAL, TEAL_2];

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
          className="relative flex cursor-pointer overflow-hidden rounded-xl border transition-colors hover:border-[color-mix(in_srgb,#0F3D4D_35%,white)]"
          style={{ backgroundColor: `color-mix(in srgb, ${TEAL} 4%, white)`, borderColor: `color-mix(in srgb, ${TEAL} 16%, white)` }}
        >
          <div className="w-1.5 flex-shrink-0" style={{ backgroundColor: TEAL }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 px-4 pt-4 pb-1.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}><BarChart2 className="w-4 h-4 text-white" /></div>
              <span className="text-base font-semibold text-foreground">Timelines</span>
              {gantt && (
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {fmtDate(gantt.rangeStart.toISOString())} — {fmtDate(gantt.rangeEnd.toISOString())} · {gantt.segments.length} fases
                </span>
              )}
            </div>
            {gantt === undefined && <div className="h-20" />}
            {gantt === null && <p className="px-4 pb-4 pt-1 text-xs text-muted-foreground">Aún no hay fechas cargadas en el timeline</p>}
            {gantt && (
              <div className="px-4 pb-4 pt-2">
                {/* Regla: inicio de cada semana (lunes), alineada con las líneas verticales de cada fila */}
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-40 flex-shrink-0" />
                  <div className="relative flex-1 h-3">
                    {weekTicks.map((t, i) => (
                      <span key={i} className="absolute text-[10px] text-muted-foreground/70 whitespace-nowrap font-mono"
                        style={{ left: `${t.pct}%`, transform: t.pct > 90 ? 'translateX(-100%)' : t.pct < 2 ? 'none' : 'translateX(-50%)' }}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
                  {gantt.segments.map((seg, i) => {
                    const color = statusColor(seg, now);
                    return (
                      <div key={`${seg.name}-${i}`} className="flex items-center gap-3">
                        <div className="w-40 flex-shrink-0">
                          <p className="text-[13px] text-foreground truncate font-medium" title={seg.name}>{seg.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{fmtRange(seg.startDate, seg.endDate)}</p>
                        </div>
                        <div className="relative flex-1 h-6">
                          {weekTicks.map((t, i2) => (
                            <div key={i2} className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${t.pct}%` }} />
                          ))}
                          {todayPct !== null && (
                            <div className="absolute top-0 bottom-0 w-px border-l border-dashed z-10" style={{ left: `${todayPct}%`, borderColor: GOLD }} />
                          )}
                          <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-full rounded-full bg-muted" />
                          <div
                            className={`absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full ${color ? '' : 'bg-muted-foreground/30'}`}
                            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%`, backgroundColor: color ?? undefined }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ── Reclutamiento ── */}
          <div onClick={() => onOpenTab('reclutamiento')} className="flex rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 flex-shrink-0" style={{ backgroundColor: TEAL }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-0.5">
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}><Users className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Reclutamiento</span>
              </div>
              {recruitment ? (
                <div className="px-3.5 pt-1.5 pb-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold font-mono leading-none" style={{ color: TEAL }}>{recruitment.totalParticipants}</span>
                    <span className="text-xs text-muted-foreground">
                      participantes · {recruitment.boards.reduce((n, b) => n + b.groups.length, 0)} grupos
                      {recruitment.boards.length > 1 ? ` · ${recruitment.boards.length} tableros` : ''}
                    </span>
                  </div>
                  {recruitment.boards.length > 1 && (
                    <div className="flex h-1.5 rounded-full overflow-hidden mt-3">
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
                  )}
                </div>
              ) : (
                <div className="h-8" />
              )}
              {recruitment && recruitment.boards.length > 0 && (
                <div className="border-t border-border max-h-[150px] overflow-y-auto px-3.5 pb-1">
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
              {recruitment && recruitment.boards.length === 0 && <p className="px-3.5 pb-3 text-xs text-muted-foreground">Sin tableros de reclutamiento</p>}
            </div>
          </div>

          {/* ── Calendario ── */}
          <div onClick={() => onOpenActividades('calendarios')} className="flex rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 flex-shrink-0" style={{ backgroundColor: INFO }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-0.5">
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${INFO}1a`, color: INFO }}><CalendarDays className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Calendario</span>
              </div>
              {events ? (
                <div className="flex items-baseline gap-2 px-3.5 pt-1.5 pb-2.5">
                  <span className="text-3xl font-semibold font-mono leading-none" style={{ color: INFO }}>{events.length}</span>
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
                        <span className="text-muted-foreground flex-shrink-0 font-mono">{ev.eventDate ? fmtDateTime(ev.eventDate) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {events && events.length === 0 && <p className="px-3.5 pb-3 text-xs text-muted-foreground">Sin sesiones registradas</p>}
            </div>
          </div>
        </div>

        {/* ── Tools (solo para quien tiene acceso) ── */}
        {canSeeTools && (
          <div
            onClick={() => onOpenTab('tools')}
            className="relative flex cursor-pointer overflow-hidden rounded-xl border transition-colors hover:border-[color-mix(in_srgb,#0F3D4D_35%,white)]"
            style={{ backgroundColor: `color-mix(in srgb, ${TEAL} 6%, white)`, borderColor: `color-mix(in srgb, ${TEAL} 18%, white)` }}
          >
            <div className="w-1 flex-shrink-0" style={{ backgroundColor: TEAL }} />
            <div className="min-w-0 flex-1 px-3.5 pb-3 pt-3">
              <div className="flex items-center gap-2">
                <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: TEAL }}>
                  <Wrench className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-medium" style={{ color: TEAL }}>Tools</span>
                {swipeSesiones && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {swipeSesiones.length} sesión{swipeSesiones.length !== 1 ? 'es' : ''} de Swipe
                  </span>
                )}
              </div>
              {!swipeSesiones && <div className="h-8" />}
              {swipeSesiones && swipeSesiones.length === 0 && (
                <p className="pb-1 pt-1.5 text-xs text-muted-foreground">Sin sesiones de Swipe todavía — ábrelo para crear la primera.</p>
              )}
              {swipeSesiones && swipeSesiones.length > 0 && (
                <div className="space-y-1 pb-0.5 pt-1.5">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* ── Presupuesto ── */}
          {canSeeBudget && (
            <div onClick={() => onOpenTab('presupuesto')} className="flex rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
              <div className="w-1 flex-shrink-0" style={{ backgroundColor: GOLD }} />
              <div className="flex-1 flex items-center gap-2.5 px-3.5 py-3">
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${GOLD}26`, color: '#8a6b0a' }}><DollarSign className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Presupuesto</span>
                <span className="ml-auto text-xs text-muted-foreground">Ver detalle</span>
              </div>
            </div>
          )}

          {/* ── Documentos ── */}
          <div onClick={() => onOpenTab('documentos')} className="flex rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 flex-shrink-0" style={{ backgroundColor: NEUTRAL }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${NEUTRAL}1a`, color: NEUTRAL }}><FileText className="w-3.5 h-3.5" /></div>
                <span className="text-sm font-medium text-foreground">Documentos</span>
              </div>
              {!teamsLinked && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Sin carpetas vinculadas</p>}
              {teamsLinked && folders && folders.length === 0 && <p className="px-3.5 pb-3.5 pt-1 text-xs text-muted-foreground">Sin archivos aún</p>}
              {teamsLinked && folders && folders.length > 0 && (
                <div className="flex flex-wrap gap-4 px-3.5 pb-3.5 pt-1">
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
          <div onClick={() => onOpenTab('chat')} className="flex rounded-xl border border-border bg-card shadow-sm hover:border-foreground/30 transition-colors cursor-pointer overflow-hidden">
            <div className="w-1 flex-shrink-0" style={{ backgroundColor: TEAL_2 }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${TEAL_2}1a`, color: TEAL_2 }}><MessageSquare className="w-3.5 h-3.5" /></div>
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
