import { z } from 'zod';
import { createEndpoint, CotizacionLineItems, Cotizaciones } from '../../server/compat';

const LineItemInput = z.object({
  subRubro: z.string(),
  rubro: z.string(),
  cantidad: z.number(),
  componentes: z.number(),
  unitCost: z.number(),
  hasMarkup: z.boolean(),
  markupPct: z.number(),
  finalPrice: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Replace all line items for a cotizacion and update totals',
  inputSchema: z.object({
    cotizacionId: z.string(),
    lineItems: z.array(LineItemInput),
    totalCost: z.number(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    // Delete all existing line items
    const existing = await CotizacionLineItems.findAll({
      filters: { cotizacion: { contains: input.cotizacionId } },
    });
    const toDelete = existing.records.filter(r => {
      const ids = Array.isArray(r.cotizacion) ? r.cotizacion : r.cotizacion ? [r.cotizacion] : [];
      return ids.includes(input.cotizacionId);
    });
    await Promise.all(toDelete.map(r => CotizacionLineItems.delete({ id: r.id })));

    // Bulk create new ones
    if (input.lineItems.length > 0) {
      await CotizacionLineItems.bulkCreate({
        records: input.lineItems.map(li => ({
          ...li,
          cotizacion: [input.cotizacionId],
        })),
      });
    }

    // Recalculate both totals from line items
    const totalCost   = input.lineItems.reduce((sum, li) => sum + li.cantidad * li.componentes * li.unitCost, 0);
    const clientPrice = input.lineItems.reduce((sum, li) => sum + li.finalPrice, 0);
    await Cotizaciones.update({
      id: input.cotizacionId,
      record: { totalCost, clientPrice },
    });

    return { success: true };
  },
});
