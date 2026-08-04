import { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarDays } from 'lucide-react';
import { format, isSameMonth, isSameYear } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { fmt, toISO, normalizeRange } from './pmDateUtils';

export function TimelineCell({ taskId, startDate, endDate, onSave }: {
  taskId: string;
  startDate: string;
  endDate: string;
  onSave: (taskId: string, start: string, end: string) => void;
}) {
  const [open, setOpen]           = useState(false);
  const [anchorDate, setAnchorDate] = useState<Date | undefined>(undefined);
  const [hoverDate,  setHoverDate]  = useState<Date | undefined>(undefined);

  const startParsed = useMemo(() => startDate ? (() => { const d = new Date(startDate + 'T00:00:00'); return isNaN(d.getTime()) ? undefined : d; })() : undefined, [startDate]);
  const endParsed   = useMemo(() => endDate   ? (() => { const d = new Date(endDate   + 'T00:00:00'); return isNaN(d.getTime()) ? undefined : d; })() : undefined, [endDate]);

  const committedRange = useMemo(() => {
    if (startParsed && endParsed) return normalizeRange(startParsed, endParsed);
    if (startParsed) return { from: startParsed, to: startParsed };
    return undefined;
  }, [startParsed, endParsed]);

  const previewRange = useMemo(() => {
    if (!anchorDate) return undefined;
    return normalizeRange(anchorDate, hoverDate ?? anchorDate);
  }, [anchorDate, hoverDate]);

  const defaultMonth = startParsed ?? endParsed ?? new Date();

  // Compact label
  const label = (() => {
    if (!startParsed && !endParsed) return null;
    if (startParsed && endParsed) {
      const year = endParsed.getFullYear();
      if (isSameMonth(startParsed, endParsed) && isSameYear(startParsed, endParsed)) {
        return `${startParsed.getDate()} → ${endParsed.getDate()} ${format(endParsed, 'MMM yyyy', { locale: es }).replace(/\.$/, '')}`;
      }
      if (isSameYear(startParsed, endParsed)) {
        return `${fmt(startParsed)} → ${fmt(endParsed)} ${year}`;
      }
      return `${fmt(startParsed)} ${startParsed.getFullYear()} → ${fmt(endParsed)} ${year}`;
    }
    if (startParsed) return `${fmt(startParsed)} →`;
    return `→ ${fmt(endParsed!)}`;
  })();

  const hasRange = !!(startParsed && endParsed);

  const handleDayClick = (day: Date) => {
    const clicked = new Date(day); clicked.setHours(0, 0, 0, 0);

    if (!anchorDate) {
      // First click — set anchor, keep popover open for second click
      setAnchorDate(clicked);
      setHoverDate(clicked);
      return;
    }

    // Second click — finalize range, save, close
    const range = normalizeRange(anchorDate, clicked);
    onSave(taskId, toISO(range.from), toISO(range.to));
    setAnchorDate(undefined);
    setHoverDate(undefined);
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setAnchorDate(undefined);
      setHoverDate(undefined);
    }
  };

  // Build modifiers for visual feedback
  const visibleRange = previewRange ?? committedRange;
  const modifiers: Record<string, Date | { from: Date; to: Date } | undefined> = {};
  const modifiersClassNames: Record<string, string> = {};

  if (visibleRange) {
    if (anchorDate) {
      // In-progress selection: show preview range
      modifiers.previewInner = { from: visibleRange.from, to: visibleRange.to };
      modifiers.previewStart = visibleRange.from;
      modifiers.previewEnd   = visibleRange.to;
      modifiersClassNames.previewInner = 'bg-accent/50 text-foreground !rounded-none';
      modifiersClassNames.previewStart = '!bg-primary !text-primary-foreground !rounded-l-md !rounded-r-none';
      modifiersClassNames.previewEnd   = '!bg-primary !text-primary-foreground !rounded-r-md !rounded-l-none';
    } else {
      // Committed (saved) range
      modifiers.committed      = { from: visibleRange.from, to: visibleRange.to };
      modifiers.committedStart = visibleRange.from;
      modifiers.committedEnd   = visibleRange.to;
      modifiersClassNames.committed      = 'bg-primary/15 text-foreground !rounded-none';
      modifiersClassNames.committedStart = '!bg-primary !text-primary-foreground !rounded-l-md !rounded-r-none';
      modifiersClassNames.committedEnd   = '!bg-primary !text-primary-foreground !rounded-r-md !rounded-l-none';
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>
        <button
          className={`group/tc flex items-center gap-1.5 w-full h-full px-2.5 py-1 text-left transition-colors hover:bg-primary/10 ${hasRange ? 'bg-primary/5' : ''}`}
          style={{ minHeight: 28 }}
        >
          {label ? (
            <span className="text-[11px] font-medium text-foreground tabular-nums leading-none">{label}</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground/30">
              <span>—</span>
              <CalendarDays className="w-3 h-3 opacity-0 group-hover/tc:opacity-100 transition-opacity" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {anchorDate && (
          <div className="px-3 pt-2.5 pb-0 text-xs text-muted-foreground">
            Ahora selecciona la fecha de fin…
          </div>
        )}
        <Calendar
          mode="default"
          defaultMonth={defaultMonth}
          numberOfMonths={2}
          locale={es}
          onDayClick={handleDayClick}
          onDayMouseEnter={(day) => {
            if (!anchorDate) return;
            const d = new Date(day); d.setHours(0, 0, 0, 0);
            setHoverDate(d);
          }}
          onDayMouseLeave={() => {
            if (anchorDate) setHoverDate(anchorDate);
          }}
          modifiers={modifiers as Parameters<typeof Calendar>[0]['modifiers']}
          modifiersClassNames={modifiersClassNames}
        />
        {(startDate || endDate) && (
          <div className="px-3 pb-2.5 border-t border-border/30 pt-2">
            <button
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => { onSave(taskId, '', ''); setAnchorDate(undefined); setHoverDate(undefined); setOpen(false); }}
            >
              Limpiar fechas
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
