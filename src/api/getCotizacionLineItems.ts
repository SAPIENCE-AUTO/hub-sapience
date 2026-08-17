import { z } from 'zod';
import { createEndpoint, CotizacionLineItems, Cotizaciones } from '../../server/compat';
import { getCotizacionAllowedDealIds } from '../lib/cotizacionAccess';

const LineItemOut = z.object({
  id: z.string(),
  subRubro: z.string().optional(),
  rubro: z.string().optional(),
  cantidad: z.number().optional(),
  unitCost: z.number().optional(),
  hasMarkup: z.boolean().optional(),
  markupPct: z.number().optional(),
  finalPrice: z.number().optional(),
  componentes: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get line items for a cotizacion',
  inputSchema: z.object({ cotizacionId: z.string() }),
  outputSchema: z.object({ lineItems: z.array(LineItemOut) }),
  execute: async ({ input, context }) => {
    // Restricción puntual (ver src/lib/cotizacionAccess.ts) reforzada aquí
    // también, no solo en getCotizaciones.ts — este endpoint se puede llamar
    // directo con cualquier cotizacionId, sin pasar por la lista de la UI
    // que ya oculta las restringidas. Sin este chequeo, alguien podría pedir
    // los rubros de una cotización ajena aunque la lista nunca la muestre.
    const allowed = getCotizacionAllowedDealIds(context.user?.email);
    if (allowed) {
      const cotiz = await Cotizaciones.findOne({ id: input.cotizacionId });
      const dealId = Array.isArray(cotiz?.deal) ? cotiz?.deal[0] : cotiz?.deal;
      if (!dealId || !allowed.has(dealId)) return { lineItems: [] };
    }

    const result = await CotizacionLineItems.findAll({
      filters: { cotizacion: { contains: input.cotizacionId } },
    });
    const filtered = result.records.filter(r => {
      const ids = Array.isArray(r.cotizacion) ? r.cotizacion : r.cotizacion ? [r.cotizacion] : [];
      return ids.includes(input.cotizacionId);
    });
    return {
      lineItems: filtered.map(li => ({
        id: li.id,
        subRubro: li.subRubro,
        rubro: li.rubro,
        cantidad: li.cantidad,
        unitCost: li.unitCost,
        hasMarkup: li.hasMarkup,
        markupPct: li.markupPct,
        finalPrice: li.finalPrice,
        componentes: li.componentes,
      })),
    };
  },
});
