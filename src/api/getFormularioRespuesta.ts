import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { fotosFirmadas } from '../serverUtils/formularios/storage';

/** Una respuesta completa, con las fotos firmadas (10 min) para verlas en el panel. */
export default createEndpoint({
  authenticated: true,
  description: 'Una respuesta de formulario con sus fotos',
  inputSchema: z.object({ respuestaId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    respuestas: z.any().optional(),
    resultado: z.any().optional(),
    fotos: z.record(z.string(), z.string()).optional(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [r] } = await pool.query(`select respuestas, resultado from formulario_respuestas where id = $1`, [input.respuestaId]);
    if (!r) return { found: false };
    return { found: true, respuestas: r.respuestas, resultado: r.resultado, fotos: await fotosFirmadas(r.respuestas) };
  },
});
