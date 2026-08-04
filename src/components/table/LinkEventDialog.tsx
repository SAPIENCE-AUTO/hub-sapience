import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronRight, Unlink, Loader2, MapPin, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getTasks } from 'zite-endpoints-sdk';
import type { GetTasksOutputType } from 'zite-endpoints-sdk';

type CalEvent = GetTasksOutputType['calendarEvents'][0];
type BoardObj = { id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectCode: string;
  currentLink?: { calBoardId: string; eventId: string };
  onLink: (calBoardId: string, eventId: string) => Promise<void>;
  onUnlink: () => Promise<void>;
  calBoardObjects?: BoardObj[];
}

function formatEventDate(iso?: string) {
  if (!iso) return '';
  try {
    return format(new Date(iso), "EEE d MMM · h:mm a", { locale: es });
  } catch { return iso; }
}

export function LinkEventDialog({ open, onOpenChange, projectCode, currentLink, onLink, onUnlink, calBoardObjects: externalObjs }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calBoardObjs, setCalBoardObjs] = useState<BoardObj[]>([]);
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [currentEventInfo, setCurrentEventInfo] = useState<CalEvent | null>(null);

  useEffect(() => {
    if (!open || !projectCode) return;
    setLoading(true);
    setSelectedBoardId(null);
    setSelectedEventId(null);
    getTasks({ projectCode })
      .then(data => {
        const objs: BoardObj[] = externalObjs ?? ((data as any).calendarBoardObjects ?? []);
        setCalBoardObjs(objs);
        setAllEvents(data.calendarEvents);
        if (currentLink) {
          const ev = data.calendarEvents.find(e => e.id === currentLink.eventId);
          setCurrentEventInfo(ev ?? null);
        }
      })
      .finally(() => setLoading(false));
  }, [open, projectCode]);

  // Derive the selected board's name for legacy event matching
  const selectedBoardObj = calBoardObjs.find(b => b.id === selectedBoardId);

  const eventsForBoard = selectedBoardId
    ? allEvents.filter(e => {
        // UUID-first: if event has boardId, match by UUID; else fallback by calendarName
        if ((e as any).boardId) return (e as any).boardId === selectedBoardId;
        return e.calendarName === selectedBoardObj?.name;
      })
    : [];

  const selectedEvent = eventsForBoard.find(e => e.id === selectedEventId);

  const handleLink = async () => {
    if (!selectedBoardId || !selectedEventId) return;
    setSaving(true);
    try {
      // Pass UUID directly — no legacy composite construction
      await onLink(selectedBoardId, selectedEventId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    setSaving(true);
    try {
      await onUnlink();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-4 h-4 text-primary flex-shrink-0" />
            {currentLink ? 'Evento vinculado' : 'Vincular a evento de calendario'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Cargando calendarios...</span>
          </div>
        ) : currentLink ? (
          /* ── Already linked: show info + unlink ── */
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 space-y-1.5">
              <p className="text-sm font-semibold text-foreground">
                {currentEventInfo?.eventName ?? 'Evento'}
              </p>
              {currentEventInfo?.eventDate && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3 flex-shrink-0" />
                  {formatEventDate(currentEventInfo.eventDate)}
                  {currentEventInfo.durationHours != null && ` · ${currentEventInfo.durationHours} hrs`}
                </p>
              )}
              {currentEventInfo?.location && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {currentEventInfo.location}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={handleUnlink}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                Desvincular
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenChange(false)}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cerrar
              </Button>
            </div>
          </div>
        ) : !selectedBoardId ? (
          /* ── Step 1: Pick calendar ── */
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-1">Selecciona un calendario del proyecto:</p>
            {calBoardObjs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No hay calendarios en este proyecto.</p>
            ) : (
              <div className="space-y-1">
                {calBoardObjs.map(board => (
                  <button
                    key={board.id}
                    onClick={() => setSelectedBoardId(board.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2.5">
                      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-sm font-medium">{board.name}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Step 2: Pick event ── */
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSelectedBoardId(null); setSelectedEventId(null); }}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                ← Calendarios
              </button>
              <span className="text-xs text-muted-foreground">/</span>
              <span className="text-xs font-medium truncate">{selectedBoardObj?.name}</span>
            </div>

            {eventsForBoard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin eventos en este calendario.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <div className="space-y-1 pr-1">
                  {[...eventsForBoard]
                    .sort((a, b) => (a.eventDate ?? '') < (b.eventDate ?? '') ? -1 : 1)
                    .map(ev => {
                      const isSelected = selectedEventId === ev.id;
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEventId(ev.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${isSelected ? 'border-primary bg-primary/10' : 'border-border/40 hover:border-primary/30 hover:bg-muted/40'}`}
                        >
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                            {ev.eventName ?? 'Sin nombre'}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            {ev.eventDate && (
                              <span className="text-xs text-muted-foreground">
                                {formatEventDate(ev.eventDate)}
                                {ev.durationHours != null && ` · ${ev.durationHours} hrs`}
                              </span>
                            )}
                          </div>
                          {ev.location && (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                              {ev.location}
                            </p>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1 border-t border-border/30">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedBoardId(null); setSelectedEventId(null); }}>
                Atrás
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                disabled={!selectedEventId || saving}
                onClick={handleLink}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarDays className="w-3.5 h-3.5" />}
                Vincular
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
