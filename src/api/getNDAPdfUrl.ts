import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { urlDelPdf } from '../serverUtils/nda/servicio';

// Liga temporal (10 min) al PDF del NDA firmado. Si el PDF no se alcanzó a guardar al firmar, se rehace aquí.
export default createEndpoint({
  authenticated: true,
  description: 'Temporary link to the signed NDA PDF (rebuilds it if it was not saved)',
  inputSchema: z.object({ envioId: z.string() }),
  outputSchema: z.object({ url: z.string() }),
  execute: async ({ input }) => ({ url: await urlDelPdf(input.envioId) }),
});
