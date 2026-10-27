import { z } from 'zod';
import { createEndpoint, Projects, Deals, Cotizaciones, CotizacionLineItems, PurchaseOrders, PurchaseOrdersRecordType, CotizacionLineItemsRecordType, CotizacionesRecordType } from '../../server/compat';

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

const projectAnalysisSchema = z.object({
  project: z.object({
    id: z.string(),
    projectCode: z.string().optional(),
    fullName: z.string().optional(),
    status: z.string().optional(),
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
});

function makeTotals(cotizado: number, costoConMarkup: number, precioCliente: number, gastado: number) {
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

/** Fetch ALL PurchaseOrders using pagination (2000 per page) */
async function fetchAllPOs(): Promise<PurchaseOrdersRecordType[]> {
  const all: PurchaseOrdersRecordType[] = [];
  let offset = 0;
  while (true) {
    const result = await PurchaseOrders.findAll({
      fields: ['status', 'projectCode', 'category', 'totalAmount'],
      sorts: [{ field: 'id', direction: 'asc' }],
      limit: 2000,
      offset,
    });
    all.push(...result.records);
    if (!result.hasMore || result.records.length === 0) break;
    offset += result.records.length;
  }
  return all;
}

/** Fetch ALL Cotizaciones using pagination (2000 per page) */
async function fetchAllCotizaciones(): Promise<CotizacionesRecordType[]> {
  const all: CotizacionesRecordType[] = [];
  let offset = 0;
  while (true) {
    const result = await Cotizaciones.findAll({ sorts: [{ field: 'id', direction: 'asc' }], limit: 2000, offset });
    all.push(...result.records);
    if (!result.hasMore || result.records.length === 0) break;
    offset += result.records.length;
  }
  return all;
}

/**
 * Las partidas de cada cotización, buscadas por la llave que guarda la propia partida (a qué cotización
 * pertenece). Zite además ponía en la cotización la lista de sus partidas (cotizacionLineItems); en Postgres
 * esa lista no existe, y leerla dejaba el «cotizado» en $0 en todos los proyectos.
 */
async function fetchLineItemsByCotizaciones(cotizacionIds: string[]): Promise<Record<string, CotizacionLineItemsRecordType[]>> {
  const byCotiz: Record<string, CotizacionLineItemsRecordType[]> = {};
  const BATCH = 100;
  for (let i = 0; i < cotizacionIds.length; i += BATCH) {
    const batch = cotizacionIds.slice(i, i + BATCH);
    let offset = 0;
    while (true) {
      const result = await CotizacionLineItems.findAll({
        filters: { cotizacion: { in: batch } } as never,
        sorts: [{ field: 'id', direction: 'asc' }],
        limit: 2000,
        offset,
      });
      for (const li of result.records) {
        const ids = Array.isArray(li.cotizacion) ? li.cotizacion : li.cotizacion ? [li.cotizacion] : [];
        for (const cotId of ids) (byCotiz[cotId as string] ??= []).push(li as CotizacionLineItemsRecordType);
      }
      if (!result.hasMore || result.records.length === 0) break;
      offset += result.records.length;
    }
  }
  return byCotiz;
}

export default createEndpoint({
  authenticated: true,
  description: 'Batch P&L analysis for multiple projects — optimized with single bulk fetches',
  inputSchema: z.object({
    projectIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    projects: z.array(projectAnalysisSchema),
    grandTotals: totalsSchema,
    dealsList: z.array(z.object({ id: z.string(), dealName: z.string(), clientPrice: z.number().nullable(), client: z.string().optional(), phase: z.string().optional() })),
  }),
  execute: async ({ input }) => {
    const [{ records: allProjects }, allPos, { records: allDeals }, allCotizaciones] = await Promise.all([
      Projects.findAll({ limit: 10_000, sorts: [{ field: 'id', direction: 'asc' }] }),
      fetchAllPOs(),
      Deals.findAll({ limit: 10_000, sorts: [{ field: 'id', direction: 'asc' }] }),
      fetchAllCotizaciones(),
    ]);

    const projectsToAnalyze = input.projectIds && input.projectIds.length > 0
      ? allProjects.filter(p => input.projectIds!.includes(p.id))
      : allProjects;

    const EXCLUDED = new Set(['Borrador', 'Cancelada']);

    // Gastado by projectCode → ocCategory → amount
    const gastadoMap: Record<string, Record<string, number>> = {};
    for (const po of allPos) {
      if (EXCLUDED.has(po.status ?? '') || !po.projectCode) continue;
      const cat = po.category ?? 'Otros';
      if (!gastadoMap[po.projectCode]) gastadoMap[po.projectCode] = {};
      gastadoMap[po.projectCode][cat] = (gastadoMap[po.projectCode][cat] ?? 0) + (po.totalAmount ?? 0);
    }

    const dealsById: Record<string, typeof allDeals[0]> = {};
    for (const d of allDeals) dealsById[d.id] = d;

    const cotizByDeal: Record<string, typeof allCotizaciones> = {};
    for (const c of allCotizaciones) {
      const dealId = Array.isArray(c.deal) ? c.deal[0] : c.deal;
      if (dealId) { (cotizByDeal[dealId] ??= []).push(c); }
    }
    for (const d of allDeals) {
      const cotizIds = Array.isArray(d.cotizaciones)
        ? d.cotizaciones
        : d.cotizaciones ? [d.cotizaciones] : [];
      for (const cid of cotizIds) {
        const cot = allCotizaciones.find(c => c.id === cid);
        if (cot && !(cotizByDeal[d.id] ?? []).some(c => c.id === cid)) {
          (cotizByDeal[d.id] ??= []).push(cot);
        }
      }
    }

    const relevantDealIds = new Set<string>();
    for (const project of projectsToAnalyze) {
      const dealId = Array.isArray(project.dealVinculado) ? project.dealVinculado[0] : project.dealVinculado;
      if (dealId) relevantDealIds.add(dealId);
    }

    const relevantCotizIds = new Set<string>();
    for (const dealId of relevantDealIds) {
      for (const cot of (cotizByDeal[dealId] ?? []).filter(c => c.included !== false)) relevantCotizIds.add(cot.id);
    }

    const lisByCotiz = await fetchLineItemsByCotizaciones(Array.from(relevantCotizIds));

    const projectAnalyses = projectsToAnalyze.map(project => {
      const dealId = Array.isArray(project.dealVinculado) ? project.dealVinculado[0] : project.dealVinculado ?? undefined;
      const gastadoByCat = project.projectCode ? (gastadoMap[project.projectCode] ?? {}) : {};

      // rubroAgg: cotizado = base cost, costoConMarkup = finalPrice (with markup)
      const rubroAgg: Record<string, { cotizado: number; costoConMarkup: number }> = {};
      let deal: { id: string; dealName: string; clientPrice: number | null; currency?: string } | null = null;

      if (dealId) {
        const dr = dealsById[dealId];
        if (dr) deal = { id: dr.id, dealName: dr.dealName ?? '', clientPrice: dr.clientPrice ?? null, currency: dr.currency };

        for (const cot of (cotizByDeal[dealId] ?? []).filter(c => c.included !== false)) {
          for (const li of lisByCotiz[cot.id] ?? []) {
            const rubro = li.rubro ?? 'Back office';
            rubroAgg[rubro] ??= { cotizado: 0, costoConMarkup: 0 };
            rubroAgg[rubro].cotizado += (li.unitCost ?? 0) * (li.cantidad ?? 1) * (li.componentes ?? 1);
            rubroAgg[rubro].costoConMarkup += li.finalPrice ?? 0;
          }
        }
      }

      // The real client price comes from the deal
      const dealClientPrice = deal?.clientPrice ?? 0;

      // Total costoConMarkup across all rubros (used for proportional distribution of precioCliente)
      const totalMarkup = Object.values(rubroAgg).reduce((s, r) => s + r.costoConMarkup, 0);

      const hasLineItems = dealId
        ? (cotizByDeal[dealId] ?? []).filter(c => c.included !== false).some(c => (lisByCotiz[c.id] ?? []).length > 0)
        : false;

      // Fallback: no line items — distribute clientPrice proportionally if cotizado data exists
      if (!hasLineItems && dealClientPrice > 0) {
        const totCotizado = Object.values(rubroAgg).reduce((s, r) => s + r.cotizado, 0);
        if (totCotizado > 0) {
          for (const rubro of RUBROS) {
            const cotRubro = rubroAgg[rubro]?.cotizado ?? 0;
            if (cotRubro > 0) {
              rubroAgg[rubro] ??= { cotizado: 0, costoConMarkup: 0 };
              rubroAgg[rubro].costoConMarkup = (cotRubro / totCotizado) * dealClientPrice;
            }
          }
        } else {
          rubroAgg['Reclutamiento e incentivos'] ??= { cotizado: 0, costoConMarkup: 0 };
          rubroAgg['Reclutamiento e incentivos'].costoConMarkup = dealClientPrice;
        }
      }

      const byRubro = RUBROS.map(rubro => {
        const cotizado = rubroAgg[rubro]?.cotizado ?? 0;
        const costoConMarkup = rubroAgg[rubro]?.costoConMarkup ?? 0;
        const gastado = gastadoByCat[RUBRO_TO_OC[rubro]] ?? 0;

        // Distribute dealClientPrice proportionally by costoConMarkup weight
        const precioCliente = totalMarkup > 0
          ? (costoConMarkup / totalMarkup) * dealClientPrice
          : 0;

        const markUpInicial = costoConMarkup - cotizado;
        const markUpFinal = precioCliente - gastado;
        const diferenciaTotalMxn = markUpFinal - markUpInicial;
        return {
          rubro, cotizado, costoConMarkup, precioCliente, gastado,
          markUpInicial, markUpFinal, diferenciaTotalMxn,
          revenueInicial: precioCliente > 0 ? (markUpInicial / precioCliente) * 100 : null,
          revenueFinal: precioCliente > 0 ? (markUpFinal / precioCliente) * 100 : null,
        };
      });

      const totCot = byRubro.reduce((s, r) => s + r.cotizado, 0);
      const totMarkup = byRubro.reduce((s, r) => s + r.costoConMarkup, 0);
      const totGas = byRubro.reduce((s, r) => s + r.gastado, 0);

      return {
        project: { id: project.id, projectCode: project.projectCode, fullName: project.fullName, status: project.status, dealId },
        deal,
        byRubro,
        totals: makeTotals(totCot, totMarkup, dealClientPrice, totGas),
      };
    });

    const grandCot = projectAnalyses.reduce((s, p) => s + p.totals.cotizado, 0);
    const grandMarkup = projectAnalyses.reduce((s, p) => s + p.totals.costoConMarkup, 0);
    const grandPC = projectAnalyses.reduce((s, p) => s + p.totals.precioCliente, 0);
    const grandGas = projectAnalyses.reduce((s, p) => s + p.totals.gastado, 0);

    return {
      projects: projectAnalyses,
      grandTotals: makeTotals(grandCot, grandMarkup, grandPC, grandGas),
      dealsList: allDeals.map(d => ({ id: d.id, dealName: d.dealName ?? '', clientPrice: d.clientPrice ?? null, client: d.client ?? undefined, phase: d.phase ?? undefined })),
    };
  },
});
