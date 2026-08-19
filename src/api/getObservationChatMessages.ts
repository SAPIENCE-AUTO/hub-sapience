import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: false,
  description: 'Últimos 100 mensajes del chat de una Sala de observación (para el observador que apenas entra)',
  inputSchema: z.object({ slug: z.string(), observerId: z.string() }),
  outputSchema: z.object({
    messages: z.array(z.object({
      id: z.string(),
      nombre: z.string().optional(),
      esProductor: z.boolean(),
      body: z.string(),
      createdAt: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    const sessionResult = await pool.query(
      `select s.id as session_id from observers o
       join observation_sessions s on s.id = o.session_id
       where o.id = $1 and s.slug = $2`,
      [input.observerId, input.slug],
    );
    const sessionId = sessionResult.rows[0]?.session_id;
    if (!sessionId) return { messages: [] };

    const result = await pool.query(
      `select id, nombre_cache, es_productor, body, created_at from (
         select c.id, c.body, c.es_productor, c.created_at,
                case when c.es_productor then 'Productor' else o.nombre end as nombre_cache
         from observation_chat c
         left join observers o on o.id = c.observer_id
         where c.session_id = $1 and c.borrado = false
         order by c.created_at desc
         limit 100
       ) t order by created_at asc`,
      [sessionId],
    );

    return {
      messages: result.rows.map((r) => ({
        id: r.id,
        nombre: r.nombre_cache ?? undefined,
        esProductor: r.es_productor,
        body: r.body,
        createdAt: r.created_at,
      })),
    };
  },
});
