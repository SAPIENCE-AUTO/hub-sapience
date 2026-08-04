import { z } from 'zod';
import { createEndpoint, Cotizaciones } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a cotizacion',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    await Cotizaciones.delete({ id: input.id });
    return { success: true };
  },
});
