import { z } from 'zod';
import { createEndpoint, Deals, Cotizaciones, CotizacionLineItems, Users, ZiteError } from 'zite-integrations-backend-sdk';

const RUBROS_ORDER = [
  'Reclutamiento e incentivos',
  'Moderación',
  'Management',
  'Logística y operación',
  'Back office',
];

export default createEndpoint({
  authenticated: true,
  description: 'Get a preview of the deal approval: line items grouped by rubro with assigned users from cotizacionRubros field',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({
    rubros: z.array(z.object({
      rubroName: z.string(),
      users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
      lineItems: z.array(z.object({
        id: z.string(),
        subRubro: z.string(),
        cantidad: z.number(),
        componentes: z.number(),
        unitCost: z.number(),
        total: z.number(),
        cotizacionName: z.string(),
      })),
    })),
    currency: z.string(),
  }),
  execute: async ({ input }) => {
    const deal = await Deals.findOne({ id: input.dealId });
    if (!deal) throw new ZiteError({ code: 'NOT_FOUND', message: 'Deal no encontrado' });

    // Get included cotizaciones
    const { records: allCots } = await Cotizaciones.findAll({
      filters: { deal: { contains: input.dealId } },
      limit: 200,
    });
    const included = allCots.filter(c => {
      const ids = Array.isArray(c.deal) ? c.deal : c.deal ? [c.deal] : [];
      return ids.includes(input.dealId) && (c as any).included === true;
    });

    // Get all line items, tagging each with its cotización name
    let allLineItems: any[] = [];
    if (included.length > 0) {
      const results = await Promise.all(
        included.map(c => CotizacionLineItems.findAll({
          filters: { cotizacion: { contains: c.id } },
          limit: 500,
        })),
      );
      allLineItems = results.flatMap((r, i) =>
        r.records.map(li => ({
          ...li,
          _cotizacionName: included[i].cotizacionName ?? `Cotización ${i + 1}`,
        })),
      );
    }

    // Get all users with cotizacionRubros assigned
    const { records: allUsers } = await Users.findAll({
      limit: 300,
      fields: ['id', 'email', 'firstName', 'lastName', 'cotizacionRubros'],
    });

    // Group line items by rubro
    const rubroItemsMap = new Map<string, any[]>();
    for (const li of allLineItems) {
      const rubro = li.rubro as string;
      if (!rubro) continue;
      if (!rubroItemsMap.has(rubro)) rubroItemsMap.set(rubro, []);
      rubroItemsMap.get(rubro)!.push(li);
    }

    // Build rubro → users map
    const rubroUsersMap = new Map<string, typeof allUsers>();
    for (const user of allUsers) {
      const rubros = (user as any).cotizacionRubros as string[] | undefined;
      if (!rubros || rubros.length === 0) continue;
      for (const rubro of rubros) {
        if (!rubroUsersMap.has(rubro)) rubroUsersMap.set(rubro, []);
        rubroUsersMap.get(rubro)!.push(user);
      }
    }

    const rawCurrency = (deal.currency ?? 'MXN').replace(/ 🇲🇽| 🇺🇸| 🇪🇺/g, '').trim();

    const rubroNames = [...rubroItemsMap.keys()].sort((a, b) => {
      const ai = RUBROS_ORDER.indexOf(a);
      const bi = RUBROS_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const rubros = rubroNames.map(rubroName => {
      const items = rubroItemsMap.get(rubroName) ?? [];
      const users = rubroUsersMap.get(rubroName) ?? [];
      return {
        rubroName,
        users: users.map(u => ({
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
          email: u.email ?? '',
        })),
        lineItems: items.map(li => {
          const cantidad = Number(li.cantidad ?? 0);
          const componentes = Number(li.componentes ?? 1);
          const unitCost = Number(li.unitCost ?? 0);
          return {
            id: li.id,
            subRubro: li.subRubro ?? '',
            cantidad,
            componentes,
            unitCost,
            total: cantidad * componentes * unitCost,
            cotizacionName: li._cotizacionName as string,
          };
        }),
      };
    });

    return { rubros, currency: rawCurrency };
  },
});
