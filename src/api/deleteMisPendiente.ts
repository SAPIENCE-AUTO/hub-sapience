import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Borra un pendiente personal (parking lot) del usuario logueado',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const result = await pool.query(
      `delete from pendientes_personales where id = $1 and user_id = $2`,
      [input.id, context.user!.id],
    );
    if (result.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pendiente no encontrado' });
    return { success: true };
  },
});
