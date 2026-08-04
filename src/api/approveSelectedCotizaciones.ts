import { z } from 'zod';
import { createEndpoint, Cotizaciones, Deals } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Approve all included cotizaciones for a deal and update its quoted cost',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), approvedCount: z.number(), totalCost: z.number() }),
  execute: async ({ input }) => {
    const result = await Cotizaciones.findAll({
      filters: { deal: { contains: input.dealId } },
    });

    const included = result.records.filter(c => {
      const ids = Array.isArray(c.deal) ? c.deal : c.deal ? [c.deal] : [];
      return ids.includes(input.dealId) && c.included === true;
    });

    await Promise.all(included.map(c =>
      Cotizaciones.update({ id: c.id, record: { status: 'Aprobada' } })
    ));

    const totalCost = included.reduce((sum, c) => sum + (c.clientPrice ?? c.totalCost ?? 0), 0);

    await Deals.update({
      id: input.dealId,
      record: { quotedCost: totalCost, phase: 'Ganado' },
    });

    return { success: true, approvedCount: included.length, totalCost };
  },
});
