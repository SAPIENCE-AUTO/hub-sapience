import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Lista las propuestas de un deal (solo Sergio)',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({
    propuestas: z.array(z.object({
      id: z.string(), titulo: z.string().optional(), estado: z.string(), version: z.number(),
      tienePptx: z.boolean(), updatedAt: z.string().optional(),
    })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const { records } = await Propuestas.findAll({
      filters: { deal: input.dealId } as never,
      sorts: [{ field: 'updatedAt', direction: 'desc' }],
      fields: ['titulo', 'estado', 'version', 'pptxPath', 'updatedAt'],
      limit: 100,
    });
    return {
      propuestas: records.map(r => ({
        id: r.id, titulo: r.titulo ?? undefined, estado: r.estado ?? 'borrador', version: Number(r.version ?? 1),
        tienePptx: !!r.pptxPath, updatedAt: r.updatedAt,
      })),
    };
  },
});
