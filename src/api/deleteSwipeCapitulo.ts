import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Borrado permanente de un capítulo — `on delete cascade` se lleva sus ideas y votos. */
export default createEndpoint({
  authenticated: true,
  description: 'Elimina permanentemente un capítulo de Swipe y todo lo que contiene',
  inputSchema: z.object({ capituloId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await pool.query(`delete from swipe_capitulos where id = $1`, [input.capituloId]);
    return { ok: true };
  },
});
