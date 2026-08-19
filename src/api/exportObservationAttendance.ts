import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Heartbeats consecutivos separados por menos de 3 minutos pertenecen al
// mismo tramo; un hueco mayor cierra el tramo y abre uno nuevo (ver
// CLAUDE (1).md, "Presencia" — evita que una pestaña dormida o una laptop
// suspendida generen tramos falsos).
const GAP_MS = 3 * 60 * 1000;

interface Tramo { start: Date; end: Date }

function computeTramos(timestamps: Date[]): Tramo[] {
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const tramos: Tramo[] = [];
  for (const ts of sorted) {
    const last = tramos[tramos.length - 1];
    if (last && ts.getTime() - last.end.getTime() < GAP_MS) {
      last.end = ts;
    } else {
      tramos.push({ start: ts, end: ts });
    }
  }
  return tramos;
}

export default createEndpoint({
  authenticated: true,
  description: 'Reporte de asistencia de la Sala de observación: tramos de conexión por email (deduplicado en el reporte, no en el registro)',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema: z.object({
    rows: z.array(z.object({
      nombre: z.string(),
      apellido: z.string(),
      email: z.string(),
      tramos: z.number(),
      rangos: z.string(),
      minutosTotales: z.number(),
    })),
  }),
  execute: async ({ input }) => {
    const sessionResult = await pool.query(
      `select id from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    const sessionId = sessionResult.rows[0]?.id;
    if (!sessionId) return { rows: [] };

    const result = await pool.query(
      `select o.nombre, o.apellido, o.email, h.ts
       from observers o
       join observer_heartbeats h on h.observer_id = o.id
       where o.session_id = $1
       order by o.email, h.ts`,
      [sessionId],
    );

    // Si la misma persona se registró desde dos dispositivos, sus heartbeats
    // se combinan en una sola línea de tiempo antes de calcular tramos — así
    // dos conexiones simultáneas no aparecen como dos asistentes distintos.
    const byEmail = new Map<string, { nombre: string; apellido: string; timestamps: Date[] }>();
    for (const row of result.rows) {
      const email = (row.email || '').toLowerCase().trim();
      if (!email) continue;
      const entry = byEmail.get(email) ?? { nombre: row.nombre ?? '', apellido: row.apellido ?? '', timestamps: [] };
      entry.timestamps.push(new Date(row.ts));
      byEmail.set(email, entry);
    }

    const rows = Array.from(byEmail.entries()).map(([email, { nombre, apellido, timestamps }]) => {
      const tramos = computeTramos(timestamps);
      const minutosTotales = tramos.reduce(
        (acc, t) => acc + Math.round((t.end.getTime() - t.start.getTime()) / 60_000),
        0,
      );
      const rangos = tramos
        .map((t) => {
          const fmt = (d: Date) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
          return `${fmt(t.start)}–${fmt(t.end)}`;
        })
        .join(', ');
      return { nombre, apellido, email, tramos: tramos.length, rangos, minutosTotales };
    });

    return { rows };
  },
});
