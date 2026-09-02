import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Borrado permanente (no hay papelera para Swipe, a diferencia del resto
 * del Hub) — el candado de "escribe BORRAR" vive en el front, aquí solo se
 * ejecuta. `on delete cascade` en el esquema se encarga de capítulos,
 * ideas, participantes y votos.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Elimina permanentemente una sesión de Swipe y todo lo que contiene',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await pool.query(`delete from swipe_sesiones where id = $1`, [input.sesionId]);
    return { ok: true };
  },
});
