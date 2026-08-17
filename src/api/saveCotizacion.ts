import { z } from 'zod';
import { createEndpoint, Cotizaciones } from '../../server/compat';

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
  execute: async ({ input, context }) => {
    const { id, ...record } = input;
    if (id) {
      await Cotizaciones.update({ id, record });
      return { id };
    }
    // Solo se graba al crear — quién hizo la cotización, no quién la editó
    // después. No viene del cliente: se toma del usuario autenticado, para
    // que no se pueda falsear desde el input.
    const created = await Cotizaciones.create({ record: { ...record, createdBy: context.user!.id } });
    return { id: created.id };
  },
});
