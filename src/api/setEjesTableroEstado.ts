import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Abre o cierra un tablero. A diferencia de Swipe, aquí no hace falta un
 * puntero "tablero_activo_id" en la sesión — getEjesEstado.ts simplemente
 * busca el primer tablero 'abierto' — pero igual solo se permite uno
 * abierto a la vez por sesión, mismo criterio que Swipe (spec §2: el
 * facilitador desbloquea de uno en uno).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Abre o cierra un tablero de Ejes',
  inputSchema: z.object({
    tableroId: z.string(),
    estado: z.enum(['bloqueado', 'abierto', 'cerrado']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const tabResult = await pool.query(`select sesion_id from ejes_tableros where id = $1`, [input.tableroId]);
    const tab = tabResult.rows[0];
    if (!tab) throw new Error('Tablero no encontrado');

    if (input.estado === 'abierto') {
      await pool.query(
        `update ejes_tableros set estado = 'bloqueado' where sesion_id = $1 and estado = 'abierto' and id != $2`,
        [tab.sesion_id, input.tableroId],
      );
      await pool.query(`update ejes_tableros set estado = 'abierto' where id = $1`, [input.tableroId]);
      await pool.query(`update ejes_sesiones set estado = 'activa' where id = $1`, [tab.sesion_id]);
    } else {
      await pool.query(`update ejes_tableros set estado = $1 where id = $2`, [input.estado, input.tableroId]);
    }

    return { ok: true };
  },
});
