import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Reordena intercambiando el `orden` con el vecino inmediato — mismo patrón que moveSwipeIdea.ts. */
export default createEndpoint({
  authenticated: true,
  description: 'Mueve una idea de Ejes un lugar arriba o abajo dentro de su tablero',
  inputSchema: z.object({ ideaId: z.string(), direccion: z.enum(['arriba', 'abajo']) }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const ideaResult = await pool.query(`select tablero_id, orden from ejes_ideas where id = $1`, [input.ideaId]);
    const idea = ideaResult.rows[0];
    if (!idea) throw new Error('Idea no encontrada');

    const vecinoResult = await pool.query(
      input.direccion === 'arriba'
        ? `select id, orden from ejes_ideas where tablero_id = $1 and orden < $2 order by orden desc limit 1`
        : `select id, orden from ejes_ideas where tablero_id = $1 and orden > $2 order by orden asc limit 1`,
      [idea.tablero_id, idea.orden],
    );
    const vecino = vecinoResult.rows[0];
    if (!vecino) return { ok: true };

    await pool.query(`update ejes_ideas set orden = $1 where id = $2`, [vecino.orden, input.ideaId]);
    await pool.query(`update ejes_ideas set orden = $1 where id = $2`, [idea.orden, vecino.id]);
    return { ok: true };
  },
});
