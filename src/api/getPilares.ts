import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { listarPilares } from '../serverUtils/pilares/servicio';
import { PilarOut } from '../serverUtils/pilares/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Catálogo de pilares (unidades de negocio: Cualitativo, Cuantitativo, Digital…), con los desactivados marcados',
  inputSchema: z.object({}),
  outputSchema: z.object({ pilares: z.array(PilarOut) }),
  execute: async () => ({ pilares: await listarPilares() }),
});
