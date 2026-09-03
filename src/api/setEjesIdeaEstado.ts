import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Abre o cierra una idea dentro de un tablero — mismo criterio que
 * setEjesTableroEstado.ts pero un nivel más abajo: solo una idea puede
 * estar 'abierto' a la vez por tablero. Al abrir una, la que estuviera
 * abierta pasa a 'cerrado' (no 'bloqueado' — ya se mostró).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Abre o cierra una idea de Ejes dentro de su tablero',
  inputSchema: z.object({
    ideaId: z.string(),
    estado: z.enum(['bloqueado', 'abierto', 'cerrado']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const ideaResult = await pool.query(`select tablero_id from ejes_ideas where id = $1`, [input.ideaId]);
    const idea = ideaResult.rows[0];
    if (!idea) throw new Error('Idea no encontrada');

    if (input.estado === 'abierto') {
      await pool.query(
        `update ejes_ideas set estado = 'cerrado' where tablero_id = $1 and estado = 'abierto' and id != $2`,
        [idea.tablero_id, input.ideaId],
      );
      await pool.query(`update ejes_ideas set estado = 'abierto' where id = $1`, [input.ideaId]);
    } else {
      await pool.query(`update ejes_ideas set estado = $1 where id = $2`, [input.estado, input.ideaId]);
    }

    return { ok: true };
  },
});
