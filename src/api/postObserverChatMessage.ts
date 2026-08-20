import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: false,
  description: 'Un observador envía un mensaje al chat de su Sala de observación',
  inputSchema: z.object({
    slug: z.string(), observerId: z.string(), body: z.string().min(1).max(2000),
    // Marcado por el botón "Pregunta para el moderador" en la sala pública —
    // resalta el mensaje ahí y en el panel del productor dentro del Hub.
    esPregunta: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select o.nombre, s.id as session_id from observers o
       join observation_sessions s on s.id = o.session_id
       where o.id = $1 and s.slug = $2`,
      [input.observerId, input.slug],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Observador no válido para esta sesión.');

    const inserted = await pool.query(
      `insert into observation_chat (session_id, observer_id, body, es_productor, es_pregunta)
       values ($1, $2, $3, false, $4) returning id, created_at`,
      [row.session_id, input.observerId, input.body, input.esPregunta],
    );
    const message = inserted.rows[0];
    await publishEvent(`observation:${row.session_id}`, 'chat.message', {
      id: message.id, nombre: row.nombre, esProductor: false, esPregunta: input.esPregunta, body: input.body, createdAt: message.created_at,
    });
    return { id: message.id };
  },
});
