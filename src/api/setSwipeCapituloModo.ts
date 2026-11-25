import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { faltaLaColumna } from '../serverUtils/swipe/aleatorio';

/**
 * Cambia un capítulo entre las cartas de siempre ('swipe') y «elegir entre las imágenes» ('duelo', una ronda proyectada
 * donde cada persona elige UNA imagen). Solo cambia cómo lo ven los participantes: los votos que ya hubiera no se tocan.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Cambia un capítulo de Swipe entre cartas (swipe) y elegir entre las imágenes (duelo)',
  inputSchema: z.object({ capituloId: z.string(), modo: z.enum(['swipe', 'duelo']) }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    try {
      const r = await pool.query(`update swipe_capitulos set modo = $1 where id = $2`, [input.modo, input.capituloId]);
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
