import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'El equipo de Sapience escribe en el chat de la Sala de observación como productor',
  inputSchema: z.object({ calendarEventId: z.string(), body: z.string().min(1).max(2000) }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const sessionResult = await pool.query(
      `select id from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    const sessionId = sessionResult.rows[0]?.id;
    if (!sessionId) throw new Error('Esta sesión no tiene Sala de observación.');

    const inserted = await pool.query(
      `insert into observation_chat (session_id, body, es_productor) values ($1, $2, true) returning id, created_at`,
      [sessionId, input.body],
    );
    const message = inserted.rows[0];
    await publishEvent(`observation:${sessionId}`, 'chat.message', {
      id: message.id, nombre: 'Productor', esProductor: true, esPregunta: false, body: input.body, createdAt: message.created_at,
    });
    return { id: message.id };
  },
});
