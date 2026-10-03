import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { pool } from '../../server/compat/db';

// Latido de uso del Hub (oct 2026) — "ver qué hace cada usuario, cuánto
// tiempo" (Sergio). El front lo manda cada ~60s mientras la pestaña está
// visible y la persona estuvo interactuando (ver useActivityTracker.ts), con
// la sección en la que está. Se acumulan segundos en una sola fila por
// (usuario, día, sección) en vez de una fila por latido.
const MAX_SECONDS_PER_BEAT = 120;

export default createEndpoint({
  authenticated: true,
  description: 'Registra segundos de uso del Hub por sección para el usuario actual',
  inputSchema: z.object({
    section: z.string().min(1).max(120),
    seconds: z.number(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const seconds = Math.max(1, Math.min(MAX_SECONDS_PER_BEAT, Math.round(input.seconds)));
    const userId = context.user!.id;
    // El día se corta en hora de CDMX, no en UTC: a las 7pm CDMX ya es el día
    // siguiente en UTC y partiría la jornada de la persona en dos.
    await pool.query(
      `insert into user_activity (user_id, day, section, seconds, updated_at)
       values ($1, (now() at time zone 'America/Mexico_City')::date, $2, $3, now())
       on conflict (user_id, day, section)
       do update set seconds = user_activity.seconds + excluded.seconds, updated_at = now()`,
      [userId, input.section, seconds],
    );
    await pool.query(`update users set last_active_at = now() where id = $1`, [userId]);
    return { success: true };
  },
});
