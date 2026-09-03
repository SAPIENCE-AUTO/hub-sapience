import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

/**
 * Mismo criterio de integridad que updateSwipeIdea.ts: si ya tiene votos,
 * borrarla destruiría resultados reales sin dejar rastro — se bloquea aquí,
 * no solo escondiendo el botón en el front.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Elimina una idea de Swipe — solo si todavía no tiene votos',
  inputSchema: z.object({ ideaId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const votos = await pool.query(`select 1 from swipe_votos where idea_id = $1 limit 1`, [input.ideaId]);
    if (votos.rows.length > 0) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Esta idea ya tiene votos — no se puede eliminar.' });
    }
    await pool.query(`delete from swipe_ideas where id = $1`, [input.ideaId]);
    return { ok: true };
  },
});
