import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAdministrarPilares } from '../serverUtils/pilares/acceso';
import { aceptarSugerencias } from '../serverUtils/pilares/servicio';
import { Uuid } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Acepta, para varios deals de golpe, el pilar que sugiere su texto viejo de «Tipo de proyecto» cuando nombra uno solo; los que mezclan pilares se dejan para repartirlos a mano — restringido a Owner o Socio',
  inputSchema: z.object({ dealIds: z.array(Uuid).max(1000) }),
  outputSchema: z.object({ aceptados: z.number(), omitidos: z.number(), mixtos: z.number() }),
  execute: async ({ input, context }) => {
    exigirAdministrarPilares(context);
    return aceptarSugerencias(input);
  },
});
