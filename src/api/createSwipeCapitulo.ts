import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Crea un capítulo dentro de una sesión de Swipe',
  inputSchema: z.object({
    sesionId: z.string(),
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from swipe_capitulos where sesion_id = $1`,
      [input.sesionId],
    );
    const orden = ordenResult.rows[0].siguiente as number;

    const result = await pool.query(
      `insert into swipe_capitulos (sesion_id, nombre, descripcion, orden) values ($1, $2, $3, $4) returning id`,
      [input.sesionId, input.nombre, input.descripcion ?? null, orden],
    );
    return { id: result.rows[0].id as string };
  },
});
