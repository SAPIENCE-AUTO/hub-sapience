import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAdministrarPilares } from '../serverUtils/pilares/acceso';
import { asignarPilarEnLote } from '../serverUtils/pilares/servicio';
import { Uuid } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Pone un solo pilar (100 %) a varios deals de golpe; los que ya tienen reparto no se tocan — restringido a Owner o Socio',
  inputSchema: z.object({ dealIds: z.array(Uuid).max(1000), pilarId: Uuid }),
  outputSchema: z.object({ asignados: z.number(), omitidos: z.number() }),
  execute: async ({ input, context }) => {
    exigirAdministrarPilares(context);
    return asignarPilarEnLote(input);
  },
});
