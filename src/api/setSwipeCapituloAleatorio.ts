import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { faltaLaColumna } from '../serverUtils/swipe/aleatorio';

/**
 * Activa o apaga el orden aleatorio de un capítulo: con él, cada participante ve las ideas en un orden distinto (para
 * que la posición de una idea no sesgue su voto). Cambiarlo con el capítulo abierto solo afecta a quien entre después.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Activa o apaga el orden aleatorio de las ideas de un capítulo de Swipe (cada participante las ve en un orden distinto)',
  inputSchema: z.object({ capituloId: z.string(), aleatorio: z.boolean() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    try {
      const r = await pool.query(`update swipe_capitulos set aleatorio = $1 where id = $2`, [input.aleatorio, input.capituloId]);
      if (!r.rowCount) throw new ZiteError({ code: 'NOT_FOUND', message: 'Capítulo no encontrado.' });
    } catch (err) {
      if (faltaLaColumna(err)) {
        throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'Falta agregar la opción en la base de datos (add-swipe-tables.ts).' });
      }
      throw err;
    }
    return { ok: true };
  },
});
