import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Reordena intercambiando el `orden` con el vecino inmediato — suficiente para una lista corta de ideas, sin necesitar drag-and-drop. */
export default createEndpoint({
  authenticated: true,
  description: 'Mueve una idea de Swipe un lugar arriba o abajo dentro de su capítulo',
  inputSchema: z.object({ ideaId: z.string(), direccion: z.enum(['arriba', 'abajo']) }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const ideaResult = await pool.query(`select capitulo_id, orden from swipe_ideas where id = $1`, [input.ideaId]);
    const idea = ideaResult.rows[0];
    if (!idea) throw new Error('Idea no encontrada');

    const vecinoResult = await pool.query(
      input.direccion === 'arriba'
        ? `select id, orden from swipe_ideas where capitulo_id = $1 and orden < $2 order by orden desc limit 1`
        : `select id, orden from swipe_ideas where capitulo_id = $1 and orden > $2 order by orden asc limit 1`,
      [idea.capitulo_id, idea.orden],
    );
    const vecino = vecinoResult.rows[0];
    if (!vecino) return { ok: true }; // ya está en la orilla, no hay con qué intercambiar

    await pool.query(`update swipe_ideas set orden = $1 where id = $2`, [vecino.orden, input.ideaId]);
    await pool.query(`update swipe_ideas set orden = $1 where id = $2`, [idea.orden, vecino.id]);
    return { ok: true };
  },
});
