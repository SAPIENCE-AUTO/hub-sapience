import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMeetingPipeline } from './meetingPipeline';
import AddNotetakerButton from './AddNotetakerButton';
import LinkMeetingRecordingPopover from './LinkMeetingRecordingPopover';
import { GOLD, INFO, EXITO, ALERTA, PELIGRO, GRIS } from '../../lib/toolColors';
import type { Session } from '../../pages/MinutasPage';

const SLOT_H = 180;
const TIME_W = 52;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 21;
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hourFrac(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

function fmtDayLabel(d: Date): string {
  const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtHour(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
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
// drag/resize ni el resto del estado de ese componente — Minutas es de
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

export default function MinutasDayView({ sessions, now, allowDeals, onOpenDetail, onChanged }: {
  sessions: Session[];
  now: number;
  allowDeals: boolean;
  onOpenDetail: (recordingId: string) => void;
  onChanged: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const dayItems = useMemo(() => {
    return sessions
      .filter(s => s.start && sameLocalDay(new Date(s.start), selectedDate))
      .map(s => {
        const start = new Date(s.start);
        const end = s.end ? new Date(s.end) : new Date(start.getTime() + 60 * 60 * 1000);
        return { session: s, startH: hourFrac(start), endH: Math.max(hourFrac(start) + 0.25, hourFrac(end)) };
      });
  }, [sessions, selectedDate]);

  const { startHour, endHour } = useMemo(() => {
    if (dayItems.length === 0) return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    const minH = Math.min(DEFAULT_START_HOUR, ...dayItems.map(i => Math.floor(i.startH)));
    const maxH = Math.max(DEFAULT_END_HOUR, ...dayItems.map(i => Math.ceil(i.endH)));
    return { startHour: Math.max(0, minH), endHour: Math.min(24, maxH) };
  }, [dayItems]);

  const positioned = useMemo(() => layoutDay(dayItems), [dayItems]);
  const hrs = useMemo(() => Array.from({ length: endHour - startHour }, (_, i) => startHour + i), [startHour, endHour]);
  const totalH = SLOT_H * hrs.length;

  const nowDate = new Date(now);
  const isToday = sameLocalDay(nowDate, selectedDate);
  const nowFrac = hourFrac(nowDate);
  const nowPct = ((nowFrac - startHour) / (endHour - startHour)) * 100;

  return (
    <div className="flex flex-col bg-card border rounded-xl relative">
      {/* Toolbar — mismo patrón que WeeklyCalendar.tsx */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b bg-card">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setSelectedDate(d => addDays(d, -1))}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="text-sm font-semibold w-56 text-center select-none">{fmtDayLabel(selectedDate)}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setSelectedDate(d => addDays(d, 1))}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => setSelectedDate(new Date())}>Hoy</Button>
      </div>

      {dayItems.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No hay juntas este día.</p>
      ) : (
        <div className="flex overflow-auto rounded-b-xl" style={{ maxHeight: '70vh' }}>
          <div style={{ width: TIME_W, flexShrink: 0 }} className="pt-1">
            {hrs.map(h => (
              <div key={h} style={{ height: SLOT_H }} className="flex items-start justify-end pr-2">
                <span className="text-[10px] text-muted-foreground/50 tabular-nums leading-none">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          <div className="flex-1 relative border-l" style={{ height: totalH }}>
            {hrs.map((h, i) => (
              <div key={h} style={{ position: 'absolute', top: i * SLOT_H, left: 0, right: 0, height: SLOT_H }} className="border-t border-border/20" />
            ))}
            {isToday && nowPct >= 0 && nowPct <= 100 && (
              <div style={{ position: 'absolute', top: `${nowPct}%`, left: 0, right: 0, zIndex: 15, display: 'flex', alignItems: 'center' }}>
                <div className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" style={{ marginLeft: -4 }} />
                <div className="flex-1 h-px bg-destructive" />
              </div>
            )}
            {positioned.map(({ session, startH, endH, column, totalColumns }) => {
              const startMs = session.start ? new Date(session.start).getTime() : NaN;
              const endMs = session.end ? new Date(session.end).getTime() : NaN;
              const isOngoing = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now <= endMs;
              const isPast = !Number.isNaN(endMs) && now > endMs;
              const canAddNotetaker = session.joinUrl && !session.recording && !isPast;
              const top = ((startH - startHour) / (endHour - startHour)) * 100;
              const height = Math.max(0.03, (endH - startH) / (endHour - startHour)) * 100;
              const color = statusColor(session, isOngoing, isPast);
              const ink = color === GOLD ? '#412402' : '#fff'; // mismo caso que ColorHead en ProjectHubLanding.tsx: gold es demasiado claro para texto blanco
              const label = statusLabel(session, isOngoing, isPast);
              const hasActions = canAddNotetaker || session.recording;

              return (
                <div
                  key={session.key}
                  onClick={() => session.recording && onOpenDetail(session.recording.id)}
                  role={session.recording ? 'button' : undefined}
                  className={`absolute bg-card border border-border rounded-lg overflow-hidden transition-colors ${session.recording ? 'cursor-pointer hover:border-foreground/30' : ''}`}
                  style={{
                    top: `${top}%`, height: `${height}%`, minHeight: hasActions ? 82 : 56,
                    left: `calc(${(column / totalColumns) * 100}% + 2px)`,
                    width: `calc(${(1 / totalColumns) * 100}% - 4px)`,
                    zIndex: 10,
                  }}
                >
                  {/* Header sólido — mismo patrón ColorHead de ProjectHubLanding.tsx: la identidad de color vive en un fondo lleno, no en un tinte ni un borde delgado */}
                  <div className="flex items-center gap-1 px-1.5 py-0.5" style={{ backgroundColor: color, color: ink }}>
                    <span className="text-[10px] font-bold truncate">{fmtHour(session.start)}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide truncate ml-auto opacity-90">{label}</span>
                  </div>
                  {/* Los botones van primero, justo bajo el header — es lo único que no se debe cortar
                      en una junta corta; el asunto/proveedor sí pueden sacrificarse si no alcanza el alto. */}
                  {hasActions && (
                    <div className="flex items-center gap-1 flex-wrap px-1.5 pt-1" onClick={e => e.stopPropagation()}>
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
                  <div className="px-1.5 py-1 flex flex-col gap-0.5">
                    <p className="text-[11px] font-semibold leading-tight text-foreground truncate">{session.subject}</p>
                    {session.provider && <span className="text-[9px] uppercase font-semibold text-muted-foreground">{session.provider}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
