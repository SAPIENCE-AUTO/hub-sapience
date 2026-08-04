import { z } from 'zod';
import { createEndpoint, Projects, Deals, Cotizaciones, CotizacionLineItems as CotizacionLineItemsSDK, Users } from 'zite-integrations-backend-sdk';

const RUBROS_ORDER = [
  'Reclutamiento e incentivos', 'Moderación', 'Management', 'Logística y operación', 'Back office',
];

export default createEndpoint({
  authenticated: true,
  description: 'Get project budget breakdown by rubro with permission-based filtering',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({
    canSeeAll: z.boolean(),
    rubros: z.array(z.object({
      rubroName: z.string(),
      lineItems: z.array(z.object({
        id: z.string(),
        subRubro: z.string(),
        cantidad: z.number(),
        componentes: z.number(),
        unitCost: z.number(),
        total: z.number(),
        cotizacionName: z.string(),
      })),
      assignedUsers: z.array(z.object({ id: z.string(), name: z.string() })),
      subtotalCotizado: z.number(),
    })),
    totals: z.object({ cotizado: z.number(), conMarkup: z.number() }),
    personas: z.array(z.object({ id: z.string(), name: z.string(), rubros: z.array(z.string()) })),
    currency: z.string(),
    dealName: z.string().optional(),
    projectCode: z.string().optional(),
  }),
  execute: async ({ input, context }) => {
    const user = context.user!;
    const canSeeAll =
      user.role === 'Owner' || user.role === 'Socio' ||
      user.accessFinanzas === 'Editar' || user.accessFinanzas === 'Administrar';
    const userRubros: string[] = (user as any).cotizacionRubros ?? [];

    // Find project by projectCode
    const project = await Projects.findOne({ filters: { projectCode: input.projectCode } });
    if (!project) return { canSeeAll, rubros: [], totals: { cotizado: 0, conMarkup: 0 }, personas: [], currency: 'MXN' };

    const dealId = Array.isArray(project.dealVinculado)
      ? project.dealVinculado[0]
      : (project.dealVinculado ?? undefined);

    let dealName: string | undefined;
    let currency = 'MXN';
    let allLineItems: import('zite-integrations-backend-sdk').CotizacionLineItemsRecordType[] = [];

    if (dealId) {
      const [dealRec, { records: cotizaciones }] = await Promise.all([
        Deals.findOne({ id: dealId }),
        Cotizaciones.findAll({ filters: { deal: { contains: dealId } } as never, limit: 200 }),
      ]);

      if (dealRec) {
        dealName = dealRec.dealName ?? undefined;
        currency = ((dealRec as any).currency ?? 'MXN').replace(/ 🇲🇽| 🇺🇸| 🇪🇺/g, '').trim();
      }

      const included = cotizaciones.filter(c => {
        const ids = Array.isArray(c.deal) ? c.deal : c.deal ? [c.deal] : [];
        return ids.includes(dealId) && (c as any).included === true;
      });

      if (included.length > 0) {
        const results = await Promise.all(
          included.map(c => CotizacionLineItemsSDK.findAll({ filters: { cotizacion: { contains: c.id } } as never, limit: 500 }))
        );
        allLineItems = results.flatMap((r, i) =>
          r.records.map(li => ({ ...li, _cotizacionName: included[i].cotizacionName ?? `Cotización ${i + 1}` }))
        ) as any;
      }
    }

    // Load users with cotizacionRubros for personas
    const { records: allUsers } = await Users.findAll({
      limit: 300,
      fields: ['id', 'email', 'firstName', 'lastName', 'cotizacionRubros'],
    });

    const personas = allUsers
      .filter(u => { const r = (u as any).cotizacionRubros as string[] | undefined; return r && r.length > 0; })
      .map(u => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
        rubros: (u as any).cotizacionRubros as string[],
      }));

    // rubro → assignedUsers map
    const rubroUsersMap = new Map<string, { id: string; name: string }[]>();
    for (const p of personas) {
      for (const rubro of p.rubros) {
        if (!rubroUsersMap.has(rubro)) rubroUsersMap.set(rubro, []);
        rubroUsersMap.get(rubro)!.push({ id: p.id, name: p.name });
      }
    }

    // Filter: only items included in budget with a non-zero total
    const budgetLineItems = allLineItems.filter(li => {
      if (!li.includedInBudget) return false;
      const total = Number(li.cantidad ?? 1) * Number(li.componentes ?? 1) * Number(li.unitCost ?? 0);
      return total > 0;
    });

    // Group line items by rubro
    const rubroItemsMap = new Map<string, import('zite-integrations-backend-sdk').CotizacionLineItemsRecordType[]>();
    for (const li of budgetLineItems) {
      const rubro = (li as any).rubro ?? 'Back office';
      if (!rubroItemsMap.has(rubro)) rubroItemsMap.set(rubro, []);
      rubroItemsMap.get(rubro)!.push(li);
    }

    const sortedRubroNames = [...rubroItemsMap.keys()].sort((a, b) => {
      const ai = RUBROS_ORDER.indexOf(a), bi = RUBROS_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });

    const visibleRubros = canSeeAll ? sortedRubroNames : sortedRubroNames.filter(r => userRubros.includes(r));

    const rubros = visibleRubros.map(rubroName => {
      const items = rubroItemsMap.get(rubroName) ?? [];
      const lineItems = items.map(li => {
        const cantidad = Number((li as any).cantidad ?? 1);
        const componentes = Number((li as any).componentes ?? 1);
        const unitCost = Number((li as any).unitCost ?? 0);
        return { id: li.id, subRubro: (li as any).subRubro ?? '', cantidad, componentes, unitCost, total: cantidad * componentes * unitCost, cotizacionName: (li as any)._cotizacionName ?? '' };
      });
      return {
        rubroName,
        lineItems,
        assignedUsers: rubroUsersMap.get(rubroName) ?? [],
        subtotalCotizado: lineItems.reduce((s, li) => s + li.total, 0),
      };
    });

    const totalCotizado = rubros.reduce((s, r) => s + r.subtotalCotizado, 0);
    const totalConMarkup = rubros.reduce((sum, r) => {
      const items = rubroItemsMap.get(r.rubroName) ?? [];
      return sum + items.reduce((s, li) => s + Number((li as any).finalPrice ?? 0), 0);
    }, 0);

    return {
      canSeeAll, rubros,
      totals: { cotizado: totalCotizado, conMarkup: totalConMarkup },
      personas, currency, dealName, projectCode: project.projectCode ?? input.projectCode,
    };
  },
});


