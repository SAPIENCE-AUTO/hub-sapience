import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { leerDefinicion } from '../lib/formularios/tipos';

/** Una versión guardada, para verla o restaurarla en el editor. Puede ser de la versión 1 del contrato: se lee como la actual. */
export default createEndpoint({
  authenticated: true,
  description: 'Una versión guardada del screener de un formulario',
  inputSchema: z.object({ versionId: z.string() }),
  outputSchema: z.object({ found: z.boolean(), definicion: z.any().optional() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [v] } = await pool.query(`select definicion from formulario_versiones where id = $1`, [input.versionId]);
    return v ? { found: true, definicion: leerDefinicion(v.definicion) } : { found: false };
  },
});
