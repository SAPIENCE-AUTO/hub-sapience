import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/**
 * «en_vivo» todavía no se ofrece: primero se prueba (Sergio, 2026-10-21) y
 * falta decidir cómo caen las respuestas reales al tablero de reclutamiento.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Cambia el estado de un formulario: borrador, prueba o cerrado',
  inputSchema: z.object({
    formularioId: z.string(),
    estado: z.enum(['borrador', 'prueba', 'cerrado']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rowCount } = await pool.query(
      `update formularios set estado = $2, updated_at = now() where id = $1`,
      [input.formularioId, input.estado],
    );
    if (!rowCount) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
    return { ok: true };
  },
});
