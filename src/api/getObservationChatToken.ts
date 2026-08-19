import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { createSubscribeToken } from '../lib/ably';

export default createEndpoint({
  authenticated: false,
  description: 'Token de Ably (subscribe-only, restringido al canal de esta sesión) para el chat de un observador',
  inputSchema: z.object({ slug: z.string(), observerId: z.string() }),
  outputSchema: z.object({
    token: z.string().optional(),
    expires: z.number().optional(),
    channel: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select s.id as session_id from observers o
       join observation_sessions s on s.id = o.session_id
       where o.id = $1 and s.slug = $2`,
      [input.observerId, input.slug],
    );
    const sessionId = result.rows[0]?.session_id;
    if (!sessionId) return { error: 'Observador no válido para esta sesión.' };

    const channel = `observation:${sessionId}`;
    const tokenResult = await createSubscribeToken([channel]);
    if (!tokenResult) return { error: 'No se pudo generar el token.' };
    return { token: tokenResult.token, expires: tokenResult.expires, channel };
  },
});
