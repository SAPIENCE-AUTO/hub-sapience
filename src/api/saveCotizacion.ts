import { z } from 'zod';
import { createEndpoint, Cotizaciones } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a cotizacion',
  inputSchema: z.object({
    id: z.string().optional(),
    cotizacionName: z.string().optional(),
    deal: z.array(z.string()).optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    totalCost: z.number().optional(),
    notes: z.string().optional(),
    included: z.boolean().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const { id, ...record } = input;
    if (id) {
      await Cotizaciones.update({ id, record });
      return { id };
    }
    const created = await Cotizaciones.create({ record });
    return { id: created.id };
  },
});
