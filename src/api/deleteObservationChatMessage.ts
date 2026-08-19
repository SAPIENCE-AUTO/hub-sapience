import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Borra (soft-delete) un mensaje del chat de la Sala de observación',
  inputSchema: z.object({ calendarEventId: z.string(), messageId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `update observation_chat c set borrado = true
       from observation_sessions s
       where c.id = $1 and c.session_id = s.id and s.calendar_event_id = $2
       returning c.session_id`,
      [input.messageId, input.calendarEventId],
    );
    const sessionId = result.rows[0]?.session_id;
    if (!sessionId) throw new Error('Mensaje no encontrado.');

    await publishEvent(`observation:${sessionId}`, 'chat.deleted', { id: input.messageId });
    return { ok: true };
  },
});
