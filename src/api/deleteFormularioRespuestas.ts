import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { borrarFotos, rutasDeFotos } from '../serverUtils/formularios/storage';

/** Borra las respuestas de prueba (y sus fotos) para dejar el formulario limpio. Nunca toca respuestas reales. */
export default createEndpoint({
  authenticated: true,
  description: 'Borra las respuestas de prueba de un formulario',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({ borradas: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(
      `delete from formulario_respuestas where formulario_id = $1 and es_prueba returning respuestas`,
      [input.formularioId],
    );
    await borrarFotos(rows.flatMap((r) => rutasDeFotos(r.respuestas)));
    return { borradas: rows.length };
  },
});
