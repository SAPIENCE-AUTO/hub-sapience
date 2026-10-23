import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { leerAviso } from '../serverUtils/formularios/aviso';

/** Público — el aviso de privacidad que leen los participantes en el formulario. */
export default createEndpoint({
  authenticated: false,
  description: 'Aviso de privacidad para los participantes de los filtros',
  inputSchema: z.object({}),
  outputSchema: z.object({
    bloques: z.array(z.object({ tipo: z.enum(['titulo', 'parrafo', 'lista']), texto: z.string() })),
  }),
  execute: async () => ({ bloques: await leerAviso() }),
});
