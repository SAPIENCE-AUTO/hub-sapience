import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Corrección manual de un voto puntual por el facilitador — mandatorio
 * (ver panel "Ver votos" en SwipeChapterEditor.tsx). Los resultados
 * agregados (getSwipeResultados/getSwipeResultadosSesion) leen swipe_votos
 * en vivo, así que el cambio se refleja solo, sin invalidar nada aparte.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Corrige manualmente el valor de un voto de Swipe',
  inputSchema: z.object({
    votoId: z.string(),
    valor: z.enum(['potencial', 'descarte', 'super']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await pool.query(`update swipe_votos set valor = $1 where id = $2`, [input.valor, input.votoId]);
    return { ok: true };
  },
});
