import { z } from 'zod';
import { createEndpoint, Cotizaciones, Deals } from '../../server/compat';
import { getCotizacionAllowedDealIds } from '../lib/cotizacionAccess';

export default createEndpoint({
  authenticated: true,
  description: 'Get all cotizaciones with resolved deal names for the admin management page',
  inputSchema: z.object({}),
  outputSchema: z.object({
    cotizaciones: z.array(z.object({
      id: z.string(),
      cotizacionName: z.string(),
      currency: z.string(),
      totalCost: z.number().nullable(),
      clientPrice: z.number().nullable(),
      status: z.string(),
      included: z.boolean(),
      dealId: z.string().nullable(),
      dealName: z.string().nullable(),
      restricted: z.boolean().optional(),
    })),
    dealsList: z.array(z.object({ id: z.string(), dealName: z.string() })),
  }),
  execute: async ({ context }) => {
    const [{ records: cotizRecords }, { records: dealRecords }] = await Promise.all([
      Cotizaciones.findAll({ limit: 2000 }),
      Deals.findAll({ fields: ['dealName'], limit: 2000 }),
    ]);

    const dealsById: Record<string, string> = {};
    for (const d of dealRecords) dealsById[d.id] = d.dealName ?? '';

    // Restricción puntual (ver src/lib/cotizacionAccess.ts): la tabla
    // conserva el mismo número de filas para todos — solo cambia si cada
    // fila trae datos reales o un placeholder que el frontend pinta como
    // skeleton, así ella no puede inferir nada de lo que falta.
    const allowed = getCotizacionAllowedDealIds(context.user?.email);

    const cotizaciones = cotizRecords.map(c => {
      const dealId = Array.isArray(c.deal) ? (c.deal[0] ?? null) : (c.deal ?? null);
      if (allowed && !(dealId && allowed.has(dealId))) {
        return {
          id: c.id, cotizacionName: '', currency: 'MXN', totalCost: null, clientPrice: null,
          status: 'Borrador', included: false, dealId: null, dealName: null, restricted: true,
        };
      }
      return {
        id: c.id,
        cotizacionName: c.cotizacionName ?? '',
        currency: c.currency ?? 'MXN',
        totalCost: c.totalCost ?? null,
        clientPrice: c.clientPrice ?? null,
        status: c.status ?? 'Borrador',
        included: c.included ?? false,
        dealId: dealId as string | null,
        dealName: dealId ? (dealsById[dealId] ?? null) : null,
      };
    });

    return {
      cotizaciones,
      dealsList: dealRecords.map(d => ({ id: d.id, dealName: d.dealName ?? '' })),
    };
  },
});
