import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { SalidaSchema, leerIndicadores } from '../serverUtils/indicadores/almacen';

/** El último cálculo de los indicadores de Reclutamiento y las metas guardadas. No calcula nada: abre al instante. */
export default createEndpoint({
  authenticated: true,
  description: 'Indicadores de Reclutamiento ya calculados y sus metas — solo Sergio',
  inputSchema: z.object({}),
  outputSchema: SalidaSchema,
  execute: async ({ context }) => {
    exigirAccesoIndicadores(context);
    return leerIndicadores('reclutamiento');
  },
});
