import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/** Guarda a mano una versión del screener tal como está guardado ahora, con un nombre («Antes de mandarlo al cliente»). */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda una versión con nombre del screener de un formulario',
  inputSchema: z.object({ formularioId: z.string(), nota: z.string().trim().min(1).max(120) }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [v] } = await pool.query(
      `insert into formulario_versiones (formulario_id, revision, definicion, nota, created_by)
       select id, revision, definicion, $2, $3 from formularios where id = $1
       returning id`,
      [input.formularioId, input.nota, context.user!.id],
    );
    if (!v) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
    return { id: v.id as string };
  },
});
