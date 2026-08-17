import { z } from 'zod';
import { createEndpoint, Cotizaciones } from '../../server/compat';
import { getCotizacionAllowedDealIds } from '../lib/cotizacionAccess';

const CotizOut = z.object({
  id: z.string(),
  cotizacionName: z.string().optional(),
  deal: z.array(z.string()).optional(),
  status: z.string().optional(),
  currency: z.string().optional(),
  totalCost: z.number().optional(),
  clientPrice: z.number().optional(),
  notes: z.string().optional(),
  included: z.boolean().optional(),
  restricted: z.boolean().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get cotizaciones for a deal',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({ cotizaciones: z.array(CotizOut) }),
  execute: async ({ input, context }) => {
    const result = await Cotizaciones.findAll({
      filters: { deal: { contains: input.dealId } },
    });

    // Restricción puntual (ver src/lib/cotizacionAccess.ts): si el deal
    // actual no está en su lista permitida, regresa placeholders sin datos
    // reales — el frontend los pinta como skeleton en vez de la tarjeta real,
    // sin revelar cuántas cotizaciones hay ni qué contienen.
    const allowed = getCotizacionAllowedDealIds(context.user?.email);
    if (allowed && !allowed.has(input.dealId)) {
      return { cotizaciones: result.records.map(c => ({ id: c.id, restricted: true })) };
    }

    return {
      cotizaciones: result.records.map(c => ({
        id: c.id,
        cotizacionName: c.cotizacionName,
        deal: Array.isArray(c.deal) ? c.deal : c.deal ? [c.deal] : undefined,
        status: c.status,
        currency: c.currency,
        totalCost: c.totalCost,
        clientPrice: c.clientPrice,
        notes: c.notes,
        included: c.included,
      })),
    };
  },
});
