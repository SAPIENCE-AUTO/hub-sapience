import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Alta rápida: varias ideas de un jalón (el front ya las separó por línea). */
export default createEndpoint({
  authenticated: true,
  description: 'Da de alta varias ideas de Ejes de un jalón dentro de un tablero',
  inputSchema: z.object({
    tableroId: z.string(),
    ideas: z.array(z.object({
      titulo: z.string().min(1).max(60),
      descripcion: z.string().max(180).optional(),
    })).min(1).max(50),
  }),
  outputSchema: z.object({ creadas: z.number() }),
  execute: async ({ input }) => {
    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from ejes_ideas where tablero_id = $1`,
      [input.tableroId],
    );
    let orden = ordenResult.rows[0].siguiente as number;

    for (const idea of input.ideas) {
      await pool.query(
        `insert into ejes_ideas (tablero_id, titulo, descripcion, orden) values ($1, $2, $3, $4)`,
        [input.tableroId, idea.titulo, idea.descripcion ?? null, orden],
      );
      orden += 1;
    }
    return { creadas: input.ideas.length };
  },
});
