import { z } from 'zod';
import { createEndpoint, Cotizaciones, CotizacionLineItems } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Duplicates a cotizacion and all its line items',
  inputSchema: z.object({
    cotizacionId: z.string(),
  }),
  outputSchema: z.object({
    id: z.string(),
    lineItemsCopied: z.number(),
  }),
  execute: async ({ input }) => {
    const original = await Cotizaciones.findOne({ id: input.cotizacionId });
    if (!original) throw new Error('Cotizacion not found');

    const newCotizacion = await Cotizaciones.create({
      record: {
        cotizacionName: `${original.cotizacionName ?? 'Sin nombre'} (copia)`,
        deal: original.deal,
        currency: original.currency,
        totalCost: original.totalCost,
        clientPrice: original.clientPrice,
        notes: original.notes,
        included: false,
        status: 'Borrador',
      },
    });

    const { records: lineItems } = await CotizacionLineItems.findAll({
      filters: { cotizacion: input.cotizacionId },
    });

    if (lineItems.length > 0) {
      await CotizacionLineItems.bulkCreate({
        records: lineItems.map(li => ({
          subRubro: li.subRubro,
          cotizacion: newCotizacion.id,
          rubro: li.rubro,
          cantidad: li.cantidad,
          unitCost: li.unitCost,
          hasMarkup: li.hasMarkup,
          markupPct: li.markupPct,
          finalPrice: li.finalPrice,
          componentes: li.componentes,
        })),
      });
    }

    return { id: newCotizacion.id, lineItemsCopied: lineItems.length };
  },
});
