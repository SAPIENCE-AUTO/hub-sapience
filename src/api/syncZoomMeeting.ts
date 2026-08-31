import { z } from 'zod';
import { createEndpoint, CalendarEvents, pool } from '../../server/compat';
import { updateZoomMeeting } from '../../server/zoom/client';

export default createEndpoint({
  authenticated: true,
  description: 'Push the calendar event current date/time/name to its linked Zoom meeting, and clear the "needs update" flag',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), message: z.string().optional() }),
  execute: async ({ input }) => {
    const event = await CalendarEvents.findOne({ id: input.calendarEventId });
    if (!event) throw new Error('El evento de calendario no existe.');
    if (!event.eventDate) throw new Error('El evento no tiene fecha/hora todavía.');

    const { rows } = await pool.query(
      `select id, zoom_meeting_id from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    const session = rows[0];
    if (!session?.zoom_meeting_id) throw new Error('Esta sesión no tiene un meeting de Zoom asociado.');

    const durationMinutes = event.durationHours ? Math.round(Number(event.durationHours) * 60) : 60;

    await updateZoomMeeting(Number(session.zoom_meeting_id), {
      topic: event.eventName || undefined,
      startTimeIso: new Date(event.eventDate).toISOString(),
      durationMinutes,
    });

    await pool.query(`update observation_sessions set zoom_needs_update = false where id = $1`, [session.id]);

    return { success: true, message: 'Horario de Zoom actualizado' };
  },
});
