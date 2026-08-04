import { useState, useMemo } from 'react';
import { GetDashboardDataOutputType } from 'zite-endpoints-sdk';
import { CalendarDays, Clock, MapPin, UserCheck, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Event = GetDashboardDataOutputType['upcomingEvents'][0];

const WEEK_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function toLocalDateStr(iso: string) {
  return iso.split('T')[0];
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.getTime() === today.getTime()) return 'Hoy';
  if (d.getTime() === tomorrow.getTime()) return 'Mañana';
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

function EventDetailDialog({ event, onClose }: { event: Event; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-6">{event.eventName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {event.assignedToMe && (
            <div className="flex items-center gap-1.5 text-primary text-sm font-medium">
              <UserCheck className="w-4 h-4" />
              <span>Eres responsable</span>
            </div>
          )}
          <div className="space-y-2 text-sm text-muted-foreground">
            {event.projectCode && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/60 w-20 shrink-0">Proyecto</span>
                <Badge variant="secondary" className="text-xs">{event.projectCode}</Badge>
              </div>
            )}
            {event.calendarName && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/60 w-20 shrink-0">Calendario</span>
                <span className="text-foreground text-xs">{event.calendarName}</span>
              </div>
            )}
            {event.eventDate && (
              <div className="flex items-start gap-2">
                <span className="text-foreground/60 w-20 shrink-0">Fecha</span>
                <span className="text-foreground text-xs capitalize">{formatFullDate(event.eventDate)}</span>
              </div>
            )}
            {event.eventDate && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/60 w-20 shrink-0">Hora</span>
                <span className="flex items-center gap-1 text-foreground text-xs">
                  <Clock className="w-3 h-3" />
                  {formatTime(event.eventDate)}
                  {event.durationHours ? ` · ${event.durationHours}h de duración` : ''}
                </span>
              </div>
            )}
            {event.location && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/60 w-20 shrink-0">Ubicación</span>
                <span className="flex items-center gap-1 text-foreground text-xs">
                  <MapPin className="w-3 h-3" />
                  {event.location}
                </span>
              </div>
            )}
          </div>
          <div className="pt-1">
            <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
              <X className="w-3.5 h-3.5 mr-1.5" />
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MiniCalendar({
  year, month, eventDates, assignedDates, selectedDay, onSelectDay, onChangeMonth,
}: {
  year: number; month: number;
  eventDates: Set<string>; assignedDates: Set<string>;
  selectedDay: string | null;
  onSelectDay: (d: string | null) => void;
  onChangeMonth: (delta: number) => void;
}) {
  const todayStr = new Date().toISOString().split('T')[0];
  const firstDay = new Date(year, month, 1);
  // Monday-based: 0=Mon ... 6=Sun
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // pad to complete rows
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(year, month, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold capitalize text-foreground">{monthLabel}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => onChangeMonth(-1)} className="p-0.5 rounded hover:bg-muted transition-colors">
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => onChangeMonth(1)} className="p-0.5 rounded hover:bg-muted transition-colors">
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEK_DAYS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDay;
          const hasEvent = eventDates.has(dateStr);
          const hasAssigned = assignedDates.has(dateStr);
          return (
            <div key={i} className="flex flex-col items-center py-0.5">
              <button
                onClick={() => onSelectDay(isSelected ? null : dateStr)}
                className={`w-7 h-7 rounded-full text-[11px] font-medium flex items-center justify-center transition-colors
                  ${isSelected ? 'bg-primary text-primary-foreground' :
                    isToday ? 'bg-primary/15 text-primary font-bold' :
                    'hover:bg-muted text-foreground'}`}
              >
                {day}
              </button>
              {hasEvent && !isSelected && (
                <div className={`w-1 h-1 rounded-full mt-0.5 ${hasAssigned ? 'bg-primary' : 'bg-secondary'}`} />
              )}
              {isSelected && hasEvent && (
                <div className="w-1 h-1 rounded-full mt-0.5 bg-primary-foreground/60" />
              )}
              {!hasEvent && <div className="w-1 h-1 mt-0.5" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventCard({ event, onClick }: { event: Event; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-card border rounded-lg p-3 space-y-1.5 hover:shadow-sm transition-all cursor-pointer
        ${event.assignedToMe ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {event.assignedToMe && <UserCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          <span className="text-sm font-medium leading-snug truncate">{event.eventName}</span>
        </div>
        {event.projectCode && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold flex-shrink-0">
            {event.projectCode}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {event.eventDate && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatTime(event.eventDate)}
            {event.durationHours ? ` · ${event.durationHours}h` : ''}
          </span>
        )}
        {event.location && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{event.location}</span>
          </span>
        )}
      </div>
    </button>
  );
}

export default function UpcomingEvents({ events }: { events: Event[] }) {
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<Event | null>(null);

  const eventDates = useMemo(() => {
    const s = new Set<string>();
    events.forEach(e => { if (e.eventDate) s.add(toLocalDateStr(e.eventDate)); });
    return s;
  }, [events]);

  const assignedDates = useMemo(() => {
    const s = new Set<string>();
    events.forEach(e => { if (e.eventDate && e.assignedToMe) s.add(toLocalDateStr(e.eventDate)); });
    return s;
  }, [events]);

  const handleChangeMonth = (delta: number) => {
    let m = calMonth + delta;
    let y = calYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCalMonth(m); setCalYear(y);
  };

  const filteredEvents = useMemo(() => {
    if (selectedDay) {
      return events
        .filter(e => e.eventDate && toLocalDateStr(e.eventDate) === selectedDay)
        .sort((a, b) => (a.eventDate ?? '') < (b.eventDate ?? '') ? -1 : 1);
    }
    const todayStr = today.toISOString().split('T')[0];
    return events
      .filter(e => e.eventDate && toLocalDateStr(e.eventDate) >= todayStr)
      .sort((a, b) => (a.eventDate ?? '') < (b.eventDate ?? '') ? -1 : 1);
  }, [events, selectedDay]);

  // Group events by day for display
  const groups = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const ev of filteredEvents) {
      if (!ev.eventDate) continue;
      const day = toLocalDateStr(ev.eventDate);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ev);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a < b ? -1 : 1);
  }, [filteredEvents]);

  return (
    <div className="space-y-4">
      {/* Mini Calendar */}
      <div className="bg-card border border-border rounded-xl p-3">
        <MiniCalendar
          year={calYear} month={calMonth}
          eventDates={eventDates} assignedDates={assignedDates}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onChangeMonth={handleChangeMonth}
        />
      </div>

      {/* Selected day label */}
      {selectedDay && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-primary">
            {formatDayLabel(selectedDay)}
          </span>
          <button onClick={() => setSelectedDay(null)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
            Ver todos
          </button>
        </div>
      )}

      {/* Event list */}
      {filteredEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center bg-muted/20 rounded-xl border border-dashed border-border">
          <CalendarDays className="w-6 h-6 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            {selectedDay ? 'Sin eventos este día' : 'Sin próximos eventos'}
          </p>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto space-y-4">
          {groups.map(([day, evs]) => (
            <div key={day}>
              {!selectedDay && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {formatDayLabel(day)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="space-y-2">
                {evs.map(ev => (
                  <EventCard key={ev.id} event={ev} onClick={() => setDetailEvent(ev)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      {detailEvent && (
        <EventDetailDialog event={detailEvent} onClose={() => setDetailEvent(null)} />
      )}
    </div>
  );
}
