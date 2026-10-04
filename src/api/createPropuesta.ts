import { z } from 'zod';
import { createEndpoint, Deals, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Crea una propuesta (borrador) ligada a un deal — generador de propuestas, solo Sergio',
  inputSchema: z.object({
    dealId: z.string(),
    notas: z.string().optional(),
    metodo: z.enum(['cualitativo', 'cuantitativo', 'mixto']).optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const deal = await Deals.findOne({ id: input.dealId });
    if (!deal) throw new Error('Deal no encontrado');
    const clientId = Array.isArray((deal as any).clientId) ? (deal as any).clientId[0] : (deal as any).clientId;
    const p = await Propuestas.create({
      record: {
        deal: [input.dealId],
        ...(clientId ? { client: [clientId] } : {}),
        titulo: deal.dealName ?? 'Propuesta',
        estado: 'borrador',
        notas: input.notas ?? null,
        metodo: input.metodo ?? null,
        createdBy: [context.user!.id],
      } as any,
    });
    return { id: p.id };
  },
});
