import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Borrado permanente — el candado de "escribe BORRAR" vive en el front. `on delete cascade` se encarga del resto. */
export default createEndpoint({
  authenticated: true,
  description: 'Elimina permanentemente una sesión de Ejes y todo lo que contiene',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await pool.query(`delete from ejes_sesiones where id = $1`, [input.sesionId]);
    return { ok: true };
  },
});
