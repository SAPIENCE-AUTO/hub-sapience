import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { borrarFotos, rutasDeFotos } from '../serverUtils/formularios/storage';

/**
 * Borra las respuestas de prueba (y sus fotos) para dejar el formulario limpio. Nunca toca respuestas reales. De una respuesta TRAÍDA de prueba se borra la copia,
 * pero no sus fotos: guarda las mismas rutas que la respuesta del filtro de origen.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Borra las respuestas de prueba de un formulario',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({ borradas: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(
      `delete from formulario_respuestas where formulario_id = $1 and es_prueba returning respuestas, (resultado ? 'traida') as traida`,
      [input.formularioId],
    );
    await borrarFotos(rows.filter((r) => !r.traida).flatMap((r) => rutasDeFotos(r.respuestas)));
    return { borradas: rows.length };
  },
});
