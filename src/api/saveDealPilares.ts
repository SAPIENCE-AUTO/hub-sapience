import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { puedeAdministrarPilares } from '../serverUtils/pilares/acceso';
import { guardarRepartoDeal } from '../serverUtils/pilares/servicio';
import { ItemEntrada, RepartoOut, Uuid } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Guarda el reparto de un deal entre pilares (ingreso y costo en pesos por pilar; los porcentajes se calculan). Quien no es Owner ni Socio solo reparte el ingreso: sus costos se conservan como estaban. También reescribe el «Tipo de proyecto» del deal con los nombres de sus pilares',
  inputSchema: z.object({ dealId: Uuid, items: z.array(ItemEntrada).max(30) }),
  outputSchema: RepartoOut,
  execute: async ({ input, context }) =>
    guardarRepartoDeal({
      dealId: input.dealId,
      items: input.items.map(i => ({ pilarId: i.pilarId, precio: i.precio ?? null, costo: i.costo ?? null })),
      veCostos: puedeAdministrarPilares(context.user),
    }),
});
