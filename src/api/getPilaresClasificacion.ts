import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAdministrarPilares } from '../serverUtils/pilares/acceso';
import { listarParaClasificar } from '../serverUtils/pilares/servicio';
import { DealBasicoOut, ItemOut, PilarOut, ResumenOut, SugerenciaOut } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Todos los deals con su reparto entre pilares y su estado (sin clasificar, por completar, listo), con la sugerencia que sale del texto viejo de «Tipo de proyecto» — para la pantalla de Pilares; restringido a Owner o Socio',
  inputSchema: z.object({}),
  outputSchema: z.object({
    pilares: z.array(PilarOut),
    deals: z.array(DealBasicoOut.extend({ items: z.array(ItemOut) }).extend(ResumenOut.shape).extend({ sugerencia: SugerenciaOut })),
  }),
  execute: async ({ context }) => {
    exigirAdministrarPilares(context);
    return listarParaClasificar();
  },
});
