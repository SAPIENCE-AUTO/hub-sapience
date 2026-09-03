import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Alta manual de una idea dentro de un tablero de Ejes',
  inputSchema: z.object({
    tableroId: z.string(),
    titulo: z.string().min(1).max(60),
    descripcion: z.string().max(180).optional(),
    imagenUrl: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from ejes_ideas where tablero_id = $1`,
      [input.tableroId],
    );
    const orden = ordenResult.rows[0].siguiente as number;

    const result = await pool.query(
      `insert into ejes_ideas (tablero_id, titulo, descripcion, imagen_url, orden) values ($1, $2, $3, $4, $5) returning id`,
      [input.tableroId, input.titulo, input.descripcion ?? null, input.imagenUrl ?? null, orden],
    );
    return { id: result.rows[0].id as string };
  },
});
