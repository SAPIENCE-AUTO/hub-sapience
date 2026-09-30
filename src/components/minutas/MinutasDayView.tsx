import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { getMeetingPipeline } from './meetingPipeline';
import AddNotetakerButton from './AddNotetakerButton';
import LinkMeetingRecordingPopover from './LinkMeetingRecordingPopover';
import { GOLD, INFO, EXITO, ALERTA, PELIGRO, GRIS } from '../../lib/toolColors';
import type { Session } from '../../pages/MinutasPage';

// "verlo de golpe toda la semana emulando un calendario de Outlook" (Sergio,
// tras aprobar que el detalle viva en un popover) — semana completa
// (Lun-Dom, mismo criterio de inicio de semana que WeeklyCalendar.tsx),
// escala un poco más alta que la primera versión de 3 días (56px/hora en
// vez de 44) ya que el popover se hizo cargo del contenido rico: la barra
// solo necesita mostrar una línea de texto, así que ganar altura no vuelve
// a arriesgar encimados.
const DAYS_TO_SHOW = 7;
const SLOT_H = 56;
const TIME_W = 44;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 19;
const DAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

// Mismo criterio que getMonday() en WeeklyCalendar.tsx — semana Lun-Dom.
function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1));
  return r;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hourFrac(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

function fmtHour(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtRangeLabel(first: Date, last: Date): string {
  const sameMonth = first.getMonth() === last.getMonth();
  const a = `${first.getDate()} ${MONTHS_ES[first.getMonth()]}`;
  const b = sameMonth ? `${last.getDate()}` : `${last.getDate()} ${MONTHS_ES[last.getMonth()]}`;
  return `${a} – ${b}`;
}

interface Positioned {
  session: Session;
  startH: number;
  endH: number;
  column: number;
  totalColumns: number;
}

// Mismo algoritmo de columnas lado-a-lado que WeeklyCalendar.tsx
// (computeEventLayout), reimplementado en chico porque acá no hace falta
// drag/resize ni el resto del estado de ese componente — Notetaker es de
// solo lectura, las sesiones vienen del calendario de Outlook/Zoom, no se
// crean ni mueven desde aquí.
function layoutDay(items: { session: Session; startH: number; endH: number }[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startH - b.startH || (b.endH - b.startH) - (a.endH - a.startH));
  const groups: (typeof sorted)[] = [];
  for (const item of sorted) {
    const overlapping = groups.filter(g => g.some(g2 => item.startH < g2.endH && item.endH > g2.startH));
    const rest = groups.filter(g => !overlapping.includes(g));
    if (overlapping.length === 0) {
      rest.push([item]);
    } else {
      rest.push([item, ...overlapping.flat()]);
    }
    groups.length = 0;
    groups.push(...rest);
  }
  const result: Positioned[] = [];
  for (const group of groups) {
    const ordered = [...group].sort((a, b) => a.startH - b.startH);
    const colEnds: number[] = [];
    const cols = new Map<Session, number>();
    for (const item of ordered) {
      let col = colEnds.findIndex(end => end <= item.startH);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = item.endH;
      cols.set(item.session, col);
    }
    const totalColumns = colEnds.length;
    for (const item of ordered) {
      result.push({ ...item, column: cols.get(item.session)!, totalColumns });
    }
  }
  return result;
}

// Misma paleta y misma lógica semántica que ESTADO_COLOR en lib/toolColors.tsx
// (activa/abierto → Éxito, cerrada → Info, borrador/bloqueado → Gris) —
// aquí con un estado más (Alerta) porque "próxima sin notetaker" sí necesita
// que el usuario haga algo, a diferencia de "sin grabar" de una junta ya
// pasada (esa ya no tiene remedio, es solo informativo → Gris).
function statusColor(session: Session, isOngoing: boolean, isPast: boolean): string {
  if (!session.recording) {
    if (isOngoing) return GOLD;
    return isPast ? GRIS : ALERTA;
  }
  const steps = getMeetingPipeline(session.recording);
  if (steps.some(s => s.state === 'error')) return PELIGRO;
  if (steps.every(s => s.state === 'done')) return EXITO;
  return INFO;
}

function statusLabel(session: Session, isOngoing: boolean, isPast: boolean): string {
  if (!session.recording) return isOngoing ? 'En curso' : isPast ? 'Sin grabar' : 'Próxima';
  const steps = getMeetingPipeline(session.recording);
  if (steps.some(s => s.state === 'error')) return 'Error de transcripción';
  if (steps.every(s => s.state === 'done')) return 'Transcrito';
  return 'Procesando';
}

interface CardProps {
  session: Session;
  color: string;
  ink: string;
  label: string;
  canAddNotetaker: boolean;
  allowDeals: boolean;
  onOpenDetail: (recordingId: string) => void;
  onChanged: () => void;
}

// Header sólido + acciones — mismo patrón ColorHead de ProjectHubLanding.tsx:
// la identidad de color vive en un fondo lleno, no en un tinte ni un borde
// delgado. Se usa igual inline (juntas largas) que adentro del popover
// (juntas cortas) para no mantener dos diseños de tarjeta distintos.
function EventCard({ session, color, ink, label, canAddNotetaker, allowDeals, onOpenDetail, onChanged }: CardProps) {
  const hasActions = canAddNotetaker || !!session.recording;
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-1 px-1.5 py-1" style={{ backgroundColor: color, color: ink }}>
        <span className="text-[11px] font-bold truncate">{fmtHour(session.start)}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wide truncate ml-auto opacity-90">{label}</span>
      </div>
      {hasActions && (
        <div className="flex items-center gap-1 flex-wrap px-1.5 pt-1.5">
          {canAddNotetaker && <AddNotetakerButton session={session} onChanged={onChanged} compact />}
          {session.recording && (
            <LinkMeetingRecordingPopover
              recordingId={session.recording.id}
              projectId={session.recording.project?.[0]}
              dealId={session.recording.deal?.[0]}
              allowDeals={allowDeals}
              onLinked={onChanged}
              compact
            />
          )}
        </div>
      )}
      <div className="px-1.5 py-1.5 flex flex-col gap-0.5">
        <p className="text-[12px] font-semibold leading-tight text-foreground">{session.subject}</p>
        {session.provider && <span className="text-[9px] uppercase font-semibold text-muted-foreground">{session.provider}</span>}
      </div>
      {session.recording && (
        <button
          onClick={() => onOpenDetail(session.recording!.id)}
          className="w-full text-left px-1.5 py-1.5 text-[10px] font-semibold text-primary hover:bg-muted border-t border-border"
        >
          Ver minuta completa →
        </button>
      )}
    </div>
  );
}

export default function MinutasDayView({ sessions, now, allowDeals, onOpenDetail, onChanged }: {
  sessions: Session[];
  now: number;
  allowDeals: boolean;
  onOpenDetail: (recordingId: string) => void;
  onChanged: () => void;
}) {
  const [windowStart, setWindowStart] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(windowStart, i)), [windowStart]);

  const perDay = useMemo(() => {
    return days.map(day => ({
      day,
      items: sessions
        .filter(s => s.start && sameLocalDay(new Date(s.start), day))
        .map(s => {
          const start = new Date(s.start);
          const end = s.end ? new Date(s.end) : new Date(start.getTime() + 60 * 60 * 1000);
          return { session: s, startH: hourFrac(start), endH: Math.max(hourFrac(start) + 0.25, hourFrac(end)) };
        }),
    }));
  }, [sessions, days]);

  const { startHour, endHour } = useMemo(() => {
    const all = perDay.flatMap(p => p.items);
    if (all.length === 0) return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    const minH = Math.min(DEFAULT_START_HOUR, ...all.map(i => Math.floor(i.startH)));
    const maxH = Math.max(DEFAULT_END_HOUR, ...all.map(i => Math.ceil(i.endH)));
    return { startHour: Math.max(0, minH), endHour: Math.min(24, maxH) };
  }, [perDay]);

  const hrs = useMemo(() => Array.from({ length: endHour - startHour }, (_, i) => startHour + i), [startHour, endHour]);
  const totalH = SLOT_H * hrs.length;
  const nowDate = new Date(now);
  const nowFrac = hourFrac(nowDate);
  const nowPct = ((nowFrac - startHour) / (endHour - startHour)) * 100;

  return (
    <div className="flex flex-col bg-card border rounded-xl relative">
      {/* Toolbar — mismo patrón que WeeklyCalendar.tsx */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b bg-card">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWindowStart(d => addDays(d, -DAYS_TO_SHOW))}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="text-sm font-semibold w-40 text-center select-none">{fmtRangeLabel(days[0], days[DAYS_TO_SHOW - 1])}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWindowStart(d => addDays(d, DAYS_TO_SHOW))}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => setWindowStart(startOfWeek(new Date()))}>Hoy</Button>
      </div>

      <div className="flex rounded-b-xl">
        <div style={{ width: TIME_W, flexShrink: 0 }} className="pt-[34px]">
          {hrs.map(h => (
            <div key={h} style={{ height: SLOT_H }} className="flex items-start justify-end pr-1">
              <span className="text-[9px] text-muted-foreground/50 tabular-nums leading-none">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {perDay.map(({ day, items }) => {
          const isToday = sameLocalDay(day, nowDate);
          const positioned = layoutDay(items);
          return (
            <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-border flex flex-col">
              <div className={`text-center py-1 border-b border-border ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="text-[9px] uppercase font-semibold text-muted-foreground">{DAYS_ES[(day.getDay() + 6) % 7]}</div>
                <div className={`text-xs font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{day.getDate()}</div>
              </div>
              <div className="relative" style={{ height: totalH }}>
                {hrs.map((h, i) => (
                  <div key={h} style={{ position: 'absolute', top: i * SLOT_H, left: 0, right: 0, height: SLOT_H }} className="border-t border-border/20" />
                ))}
                {isToday && nowPct >= 0 && nowPct <= 100 && (
                  <div style={{ position: 'absolute', top: `${nowPct}%`, left: 0, right: 0, zIndex: 15, display: 'flex', alignItems: 'center' }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" style={{ marginLeft: -3 }} />
                    <div className="flex-1 h-px bg-destructive" />
                  </div>
                )}
                {positioned.map(({ session, startH, endH, column, totalColumns }) => {
                  const startMs = session.start ? new Date(session.start).getTime() : NaN;
                  const endMs = session.end ? new Date(session.end).getTime() : NaN;
                  const isOngoing = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now <= endMs;
                  const isPast = !Number.isNaN(endMs) && now > endMs;
                  const canAddNotetaker = !!session.joinUrl && !session.recording && !isPast;
                  const top = ((startH - startHour) / (endHour - startHour)) * 100;
                  const heightPct = Math.max(0.03, (endH - startH) / (endHour - startHour)) * 100;
                  const color = statusColor(session, isOngoing, isPast);
                  const ink = color === GOLD ? '#412402' : '#fff';
                  const label = statusLabel(session, isOngoing, isPast);
                  const hasActions = canAddNotetaker || !!session.recording;

                  // La barra siempre es una sola línea de texto truncable —
                  // nunca se le mete la tarjeta rica adentro, porque a esta
                  // escala (todo el horario laboral a la vista) la altura real
                  // de una junta casi nunca alcanza para header+botones+asunto
                  // sin encimarse con la siguiente. El detalle completo vive
                  // en el popover, que no está atado al alto de la barra.
                  const positionStyle = {
                    top: `${top}%`, height: `${heightPct}%`, minHeight: 15,
                    left: `calc(${(column / totalColumns) * 100}% + 1px)`,
                    width: `calc(${(1 / totalColumns) * 100}% - 2px)`,
                    zIndex: 10,
                  };

                  const bar = (
                    <div
                      className={`w-full h-full flex items-center gap-1 px-1 rounded overflow-hidden text-left ${hasActions ? 'cursor-pointer hover:brightness-95' : ''}`}
                      style={{ backgroundColor: color, color: ink }}
                    >
                      <span className="text-[9px] font-bold truncate shrink-0">{fmtHour(session.start)}</span>
                      <span className="text-[9px] truncate opacity-90">{session.subject}</span>
                    </div>
                  );

                  if (!hasActions) {
                    return <div key={session.key} className="absolute" style={positionStyle}>{bar}</div>;
                  }

                  return (
                    <div key={session.key} className="absolute" style={positionStyle}>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="w-full h-full block">{bar}</button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-0" align="start" onClick={e => e.stopPropagation()}>
                          <EventCard session={session} color={color} ink={ink} label={label} canAddNotetaker={canAddNotetaker} allowDeals={allowDeals} onOpenDetail={onOpenDetail} onChanged={onChanged} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
