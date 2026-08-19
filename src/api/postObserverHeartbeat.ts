import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: false,
  description: 'Heartbeat de presencia de un observador — insert-only, nunca upsert (la historia completa es el dato)',
  inputSchema: z.object({ slug: z.string(), observerId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `insert into observer_heartbeats (session_id, observer_id, ts)
       select s.id, o.id, now()
       from observers o
       join observation_sessions s on s.id = o.session_id
       where o.id = $1 and s.slug = $2
       returning id`,
      [input.observerId, input.slug],
    );
    return { ok: result.rows.length > 0 };
  },
});
