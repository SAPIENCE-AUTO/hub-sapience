import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, pool } from '../../server/compat';
import { updateZoomMeeting, createZoomMeeting, setZoomLiveStream, deleteZoomMeeting } from '../../server/zoom/client';
import { isZoomHostFree, pickFreeZoomHost, zoomHostPool, MUX_SERVER_URL } from '../serverUtils/provisionObservationSession';
import { resolveWriteBoardId, smartWriteCellValue } from '../serverUtils/smartWrite';
import { OBSERVATION_ZOOM_LINK_COLUMN } from '../serverUtils/calendarDefaults';

export default createEndpoint({
  authenticated: true,
  description: 'Push the calendar event current date/time/name to its linked Zoom meeting, reassigning to a free account if the current host now conflicts',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), message: z.string().optional(), reassigned: z.boolean().optional() }),
  execute: async ({ input }) => {
    const event = await CalendarEvents.findOne({ id: input.calendarEventId });
    if (!event) throw new Error('El evento de calendario no existe.');
    if (!event.eventDate) throw new Error('El evento no tiene fecha/hora todavía.');

    const { rows } = await pool.query(
      `select id, zoom_meeting_id, zoom_host_email, mux_stream_key, slug from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    const session = rows[0];
    if (!session?.zoom_meeting_id) throw new Error('Esta sesión no tiene un meeting de Zoom asociado.');

    const startTime = new Date(event.eventDate);
    const durationMinutes = event.durationHours ? Math.round(Number(event.durationHours) * 60) : 60;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    // ── Caso normal: la cuenta ya asignada sigue libre a la nueva hora ──────
    const hostStillFree = session.zoom_host_email
      ? await isZoomHostFree(session.zoom_host_email, startTime, endTime, session.id)
      : false;

    if (hostStillFree) {
      await updateZoomMeeting(Number(session.zoom_meeting_id), {
        topic: event.eventName || undefined,
        startTimeIso: startTime.toISOString(),
        durationMinutes,
      });
      await pool.query(`update observation_sessions set zoom_needs_update = false where id = $1`, [session.id]);
      return { success: true, message: 'Horario de Zoom actualizado', reassigned: false };
    }

    // ── Choque de horario: la cuenta asignada ya tiene otra sesión ahí ──────
    // No se puede simplemente mover el meeting hacia un choque real — hay que
    // reasignar a otra cuenta libre del pool, apuntando el mismo Mux (el
    // "Link de observación" que va en el invite nunca cambia, solo el link
    // crudo de Zoom que vive en la columna del tablero).
    const newHost = await pickFreeZoomHost(startTime, endTime, session.id);
    if (!newHost) throw new Error('El horario nuevo choca y no hay ninguna otra cuenta de Zoom libre a esa hora.');

    const alternativeHosts = zoomHostPool().filter(h => h !== newHost);
    const meeting = await createZoomMeeting({
      hostEmail: newHost,
      alternativeHosts,
      topic: event.eventName || 'Sesión de observación',
      startTimeIso: startTime.toISOString(),
      durationMinutes,
    });

    const appUrl = (process.env.ZITE_APP_URL ?? '').split(',')[0]?.trim() || 'http://localhost:5173';
    await setZoomLiveStream(meeting.id, {
      streamUrl: MUX_SERVER_URL,
      streamKey: session.mux_stream_key,
      pageUrl: `${appUrl}/s/${session.slug}`,
    });

    // Best-effort: un meeting viejo que no se pudo borrar no debe tronar la reasignación.
    try { await deleteZoomMeeting(Number(session.zoom_meeting_id)); } catch { /* huérfano aceptable */ }

    await pool.query(
      `update observation_sessions set zoom_meeting_id = $1, zoom_join_url = $2, zoom_start_url = $3, zoom_host_email = $4, zoom_needs_update = false where id = $5`,
      [String(meeting.id), meeting.join_url, meeting.start_url, newHost, session.id],
    );

    // Actualiza la celda "Link Zoom" del tablero — informativa, para quien
    // necesite el link crudo del host real. El "Link de observación" (lo que
    // de verdad va en el invite de Outlook) no vive aquí y no se toca.
    try {
      const boardIdCandidate = event.boardId || (event.projectCode && event.calendarName ? `cal-${event.projectCode}-${event.calendarName}` : undefined);
      if (boardIdCandidate) {
        const resolution = await resolveWriteBoardId(boardIdCandidate, event.projectCode && event.calendarName
          ? { projectCode: event.projectCode, boardName: event.calendarName, boardType: 'calendar' }
          : undefined);
        const cols = await BoardColumns.findAll({ filters: { boardId: resolution.writeBoardId }, limit: 100 });
        const zoomCol = cols.records.find(c => c.columnName === OBSERVATION_ZOOM_LINK_COLUMN);
        if (zoomCol) {
          await smartWriteCellValue({
            uuidBoardId: resolution.writeBoardId,
            legacyBoardId: resolution.legacyBoardId,
            rowId: input.calendarEventId,
            columnId: zoomCol.id,
            values: { fileUrl: meeting.join_url },
            isEmpty: false,
          });
        }
      }
    } catch (err) {
      console.error('[syncZoomMeeting] No se pudo actualizar la celda "Link Zoom" (no crítico):', err);
    }

    return { success: true, message: 'Zoom reasignado a otra cuenta por choque de horario', reassigned: true };
  },
});
