import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { puedeAdministrarPilares } from '../serverUtils/pilares/acceso';
import { leerRepartoDeal } from '../serverUtils/pilares/servicio';
import { RepartoOut, Uuid } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Reparto de un deal entre pilares: el catálogo, lo que le toca a cada pilar de ingreso (y de costo, solo para Owner o Socio), si el reparto está completo y lo que sugiere su texto viejo de «Tipo de proyecto»',
  inputSchema: z.object({ dealId: Uuid }),
  outputSchema: RepartoOut,
  execute: async ({ input, context }) => leerRepartoDeal(input.dealId, puedeAdministrarPilares(context.user)),
});
