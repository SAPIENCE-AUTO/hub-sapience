import { z } from 'zod';
import { createEndpoint, CotizacionLineItems } from 'zite-integrations-backend-sdk';

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
  execute: async ({ input }) => {
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
