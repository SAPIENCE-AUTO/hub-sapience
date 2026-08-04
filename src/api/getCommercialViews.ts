import { z } from 'zod';
import { createEndpoint, CommercialDashboardViews } from 'zite-integrations-backend-sdk';

const ViewOut = z.object({
  dbId: z.string(),
  viewId: z.string(),
  viewName: z.string(),
  isDefault: z.boolean(),
  isShared: z.boolean(),
  filtersJson: z.string(),
  widgetsJson: z.string(),
  dateReference: z.string(),
  sortOrder: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get commercial dashboard views for the current user (owned + shared)',
  inputSchema: z.object({}),
  outputSchema: z.object({ views: z.array(ViewOut) }),
  execute: async ({ context }) => {
    const result = await CommercialDashboardViews.findAll({});
    const userId = context.user!.id;

    const relevant = result.records.filter(v => {
      const ownerArr = Array.isArray(v.owner) ? v.owner : v.owner ? [v.owner] : [];
      return ownerArr.includes(userId) || v.isShared === true;
    });

    return {
      views: relevant
        .map(v => ({
          dbId: v.id,
          viewId: v.viewId ?? v.id,
          viewName: v.viewName ?? 'Sin nombre',
          isDefault: v.isDefault ?? false,
          isShared: v.isShared ?? false,
          filtersJson: v.filtersJson ?? '{}',
          widgetsJson: v.widgetsJson ?? '[]',
          dateReference: v.dateReference === 'Fecha de aprobación' ? 'approvalDate' : 'proposalDate',
          sortOrder: v.sortOrder ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    };
  },
});
