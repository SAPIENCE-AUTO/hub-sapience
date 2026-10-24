import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/**
 * Cambia el estado de un filtro. «En vivo» (Sergio, 2026-10-24): lo que entra
 * cuenta como real, el formulario ya no dice «Prueba» y «Borrar pruebas» no lo
 * toca. Con respuestas reales ya no regresa a borrador ni a prueba (lo nuevo
 * quedaría como prueba y se podría borrar): solo se cierra o se reabre en vivo.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Cambia el estado de un formulario: borrador, prueba, en vivo o cerrado',
  inputSchema: z.object({
    formularioId: z.string(),
    estado: z.enum(['borrador', 'prueba', 'en_vivo', 'cerrado']),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    if (input.estado === 'borrador' || input.estado === 'prueba') {
      const { rows: [r] } = await pool.query(
        `select exists (select 1 from formulario_respuestas where formulario_id = $1 and not es_prueba) as hay`,
        [input.formularioId],
      );
      if (r?.hay) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este filtro ya tiene respuestas reales: solo se puede cerrar o reabrir en vivo.' });
    }
    const { rowCount } = await pool.query(
      `update formularios set estado = $2, updated_at = now() where id = $1`,
      [input.formularioId, input.estado],
    );
    if (!rowCount) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
    return { ok: true };
  },
});
