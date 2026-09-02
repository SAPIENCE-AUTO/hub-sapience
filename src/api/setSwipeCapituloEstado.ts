import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Abre o cierra un capítulo. Solo puede haber un capítulo "abierto" a la vez
 * por sesión — al abrir uno, cualquier otro que ya estuviera abierto vuelve
 * a "bloqueado" (el facilitador desbloquea capítulos uno a la vez, spec §2).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Abre o cierra un capítulo de Swipe',
  inputSchema: z.object({
    capituloId: z.string(),
    estado: z.enum(['bloqueado', 'abierto', 'cerrado']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const capResult = await pool.query(`select sesion_id from swipe_capitulos where id = $1`, [input.capituloId]);
    const cap = capResult.rows[0];
    if (!cap) throw new Error('Capítulo no encontrado');

    if (input.estado === 'abierto') {
      await pool.query(
        `update swipe_capitulos set estado = 'bloqueado' where sesion_id = $1 and estado = 'abierto' and id != $2`,
        [cap.sesion_id, input.capituloId],
      );
      await pool.query(`update swipe_capitulos set estado = 'abierto' where id = $1`, [input.capituloId]);
      await pool.query(
        `update swipe_sesiones set estado = 'activa', capitulo_activo_id = $1 where id = $2`,
        [input.capituloId, cap.sesion_id],
      );
    } else {
      await pool.query(`update swipe_capitulos set estado = $1 where id = $2`, [input.estado, input.capituloId]);
      await pool.query(
        `update swipe_sesiones set capitulo_activo_id = null where id = $1 and capitulo_activo_id = $2`,
        [cap.sesion_id, input.capituloId],
      );
    }

    return { ok: true };
  },
});
