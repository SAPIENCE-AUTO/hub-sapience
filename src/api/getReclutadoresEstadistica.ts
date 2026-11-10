import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoIndicadores } from '../serverUtils/indicadores/acceso';
import { SalidaReclutadoresSchema, leerReclutadores } from '../serverUtils/indicadores/reclutadoresAlmacen';

/** La estadística por reclutador ya calculada, los reclutadores y a quién pertenece cada forma de escribir el nombre. No calcula nada: abre al instante. */
export default createEndpoint({
  authenticated: true,
  description: 'Estadística por reclutador (respuestas nuevas y repetidas) ya calculada, y los nombres que se han juntado — solo Sergio',
  inputSchema: z.object({}),
  outputSchema: SalidaReclutadoresSchema,
  execute: async ({ context }) => {
    exigirAccesoIndicadores(context);
    return leerReclutadores();
  },
});
