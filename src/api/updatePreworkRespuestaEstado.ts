import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Cambia el estado de revisión de una respuesta de Prework',
  inputSchema: z.object({ respuestaId: z.string(), estado: z.enum(['pendiente', 'entregada', 'revisada']) }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `update prework_respuestas set estado = $1, updated_at = now() where id = $2`,
      [input.estado, input.respuestaId],
    );
    if (result.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Respuesta no encontrada' });
    return { success: true };
  },
});
