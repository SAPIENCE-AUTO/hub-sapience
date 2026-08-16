export interface GanttPhase {
  name: string;
  status?: string;
  startDate: string;
  endDate: string;
}

export interface GanttSegment {
  name: string;
  status?: string;
  startDate: string;
  endDate: string;
  leftPct: number;
  widthPct: number;
}

export interface GanttData {
  rangeStart: Date;
  rangeEnd: Date;
  segments: GanttSegment[];
}

const MIN_WIDTH_PCT = 2;

/** Posiciona cada fase en un eje de fechas real (0-100%) a partir de su propio startDate/endDate — así los traslapes entre fases se ven correctamente, sin asumir que van en secuencia. */
export function computeGanttSegments(phases: GanttPhase[]): GanttData | null {
  const valid = phases.filter(p => p.startDate && p.endDate);
  if (valid.length === 0) return null;

  const starts = valid.map(p => new Date(p.startDate).getTime());
  const ends = valid.map(p => new Date(p.endDate).getTime());
  const rangeStartMs = Math.min(...starts);
  const rangeEndMs = Math.max(...ends);
  const span = rangeEndMs - rangeStartMs;

  const segments: GanttSegment[] = valid.map(p => {
    const s = new Date(p.startDate).getTime();
    const e = new Date(p.endDate).getTime();
    const leftPct = span > 0 ? ((s - rangeStartMs) / span) * 100 : 0;
    const rawWidthPct = span > 0 ? ((e - s) / span) * 100 : 100;
    return {
      name: p.name, status: p.status, startDate: p.startDate, endDate: p.endDate,
      leftPct, widthPct: Math.max(rawWidthPct, MIN_WIDTH_PCT),
    };
  });

  return { rangeStart: new Date(rangeStartMs), rangeEnd: new Date(rangeEndMs), segments };
}
