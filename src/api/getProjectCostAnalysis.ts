import { z } from 'zod';
import { createEndpoint, Projects, Deals, Cotizaciones, CotizacionLineItems, PurchaseOrders } from '../../server/compat';

const RUBROS = ['Reclutamiento e incentivos', 'Moderación', 'Management', 'Logística y operación', 'Back office'] as const;

const RUBRO_TO_OC: Record<string, string> = {
  'Reclutamiento e incentivos': 'Reclutamiento e Incentivos',
  'Moderación': 'Moderaciones',
  'Management': 'Management',
  'Logística y operación': 'Logística',
  'Back office': 'Otros',
};

const rubroRow = z.object({
  rubro: z.string(),
  cotizado: z.number(),
  costoConMarkup: z.number(),
  precioCliente: z.number(),
  gastado: z.number(),
  markUpInicial: z.number(),
  markUpFinal: z.number(),
  diferenciaTotalMxn: z.number(),
  revenueInicial: z.number().nullable(),
  revenueFinal: z.number().nullable(),
});

const totalsSchema = z.object({
  cotizado: z.number(),
  costoConMarkup: z.number(),
  precioCliente: z.number(),
  gastado: z.number(),
  markUpInicial: z.number(),
  markUpFinal: z.number(),
  diferenciaTotalMxn: z.number(),
  revenueInicial: z.number().nullable(),
  revenueFinal: z.number().nullable(),
});

function calcMetrics(cotizado: number, costoConMarkup: number, precioCliente: number, gastado: number) {
  const markUpInicial = costoConMarkup - cotizado;
  const markUpFinal = precioCliente - gastado;
  const diferenciaTotalMxn = markUpFinal - markUpInicial;
  return {
    cotizado, costoConMarkup, precioCliente, gastado,
    markUpInicial, markUpFinal, diferenciaTotalMxn,
    revenueInicial: precioCliente > 0 ? (markUpInicial / precioCliente) * 100 : null,
    revenueFinal: precioCliente > 0 ? (markUpFinal / precioCliente) * 100 : null,
  };
}

export default createEndpoint({
  authenticated: true,
  description: 'P&L cost analysis: cotizado vs gastado by rubro for a project',
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({
    project: z.object({
      id: z.string(),
      projectCode: z.string().optional(),
      fullName: z.string().optional(),
      dealId: z.string().optional(),
    }),
    deal: z.object({
      id: z.string(),
      dealName: z.string(),
      clientPrice: z.number().nullable(),
      currency: z.string().optional(),
    }).nullable(),
    byRubro: z.array(rubroRow),
    totals: totalsSchema,
    deals: z.array(z.object({ id: z.string(), dealName: z.string() })),
  }),
  execute: async ({ input }) => {
    const project = await Projects.findOne({ id: input.projectId });
    if (!project) throw new Error('Proyecto no encontrado');

    const dealId = Array.isArray(project.dealVinculado)
      ? project.dealVinculado[0]
      : project.dealVinculado ?? undefined;

    const [{ records: allDeals }, posResult] = await Promise.all([
      Deals.findAll({ limit: 500, fields: ['dealName'] }),
      project.projectCode
        ? PurchaseOrders.findAll({ filters: { projectCode: project.projectCode } as never, limit: 500 })
        : Promise.resolve({ records: [] }),
    ]);

    const EXCLUDED = new Set(['Borrador', 'Cancelada']);
    const gastadoByOcCat: Record<string, number> = {};
    for (const po of posResult.records) {
      if (EXCLUDED.has(po.status ?? '')) continue;
      const cat = po.category ?? 'Otros';
      gastadoByOcCat[cat] = (gastadoByOcCat[cat] ?? 0) + (po.totalAmount ?? 0);
    }

    let deal: { id: string; dealName: string; clientPrice: number | null; currency?: string } | null = null;
    const lineItemsByRubro: Record<string, { cotizado: number; costoConMarkup: number }> = {};

    if (dealId) {
      const [dealRec, { records: cotizaciones }] = await Promise.all([
        Deals.findOne({ id: dealId }),
        Cotizaciones.findAll({ filters: { deal: { contains: dealId } } as never, limit: 200 }),
      ]);

      if (dealRec) {
        deal = { id: dealRec.id, dealName: dealRec.dealName ?? '', clientPrice: dealRec.clientPrice ?? null, currency: dealRec.currency };
      }

      const included = cotizaciones.filter(c => c.included !== false);
      const liResults = await Promise.all(
        included.map(cot =>
          CotizacionLineItems.findAll({ filters: { cotizacion: { contains: cot.id } } as never, limit: 500 })
        )
      );

      for (let i = 0; i < included.length; i++) {
        const cotId = included[i].id;
        const items = liResults[i].records.filter(li => {
          const ids = Array.isArray(li.cotizacion) ? li.cotizacion : li.cotizacion ? [li.cotizacion] : [];
          return ids.includes(cotId);
        });
        for (const li of items) {
          const rubro = li.rubro ?? 'Back office';
          if (!lineItemsByRubro[rubro]) lineItemsByRubro[rubro] = { cotizado: 0, costoConMarkup: 0 };
          lineItemsByRubro[rubro].cotizado += (li.unitCost ?? 0) * (li.cantidad ?? 1);
          lineItemsByRubro[rubro].costoConMarkup += li.finalPrice ?? 0;
        }
      }
    }

    const dealClientPrice = deal?.clientPrice ?? 0;
    const totalMarkupSum = Object.values(lineItemsByRubro).reduce((s, r) => s + r.costoConMarkup, 0);

    const byRubro = RUBROS.map(rubro => {
      const cotizado = lineItemsByRubro[rubro]?.cotizado ?? 0;
      const costoConMarkup = lineItemsByRubro[rubro]?.costoConMarkup ?? 0;
      const gastado = gastadoByOcCat[RUBRO_TO_OC[rubro]] ?? 0;
      const precioCliente = totalMarkupSum > 0 ? (costoConMarkup / totalMarkupSum) * dealClientPrice : 0;
      return { rubro, ...calcMetrics(cotizado, costoConMarkup, precioCliente, gastado) };
    });

    const totCotizado = byRubro.reduce((s, r) => s + r.cotizado, 0);
    const totMarkup = byRubro.reduce((s, r) => s + r.costoConMarkup, 0);
    const totGastado = byRubro.reduce((s, r) => s + r.gastado, 0);

    return {
      project: { id: project.id, projectCode: project.projectCode, fullName: project.fullName, dealId },
      deal,
      byRubro,
      totals: calcMetrics(totCotizado, totMarkup, dealClientPrice, totGastado),
      deals: allDeals.map(d => ({ id: d.id, dealName: d.dealName ?? '' })),
    };
  },
});
