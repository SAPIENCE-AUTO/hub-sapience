import { z } from 'zod';
import { createEndpoint, CommercialDashboardViews } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a commercial dashboard view. If viewId is provided, updates existing; otherwise creates new.',
  inputSchema: z.object({
    viewId: z.string().optional(),
    viewName: z.string(),
    filtersJson: z.string(),
    widgetsJson: z.string(),
    dateReference: z.enum(['proposalDate', 'approvalDate']),
    isDefault: z.boolean().optional(),
    isShared: z.boolean().optional(),
    sortOrder: z.number().optional(),
  }),
  outputSchema: z.object({ dbId: z.string(), viewId: z.string() }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;

    // Map dateReference to select option value
    const dateRefValue = input.dateReference === 'approvalDate'
      ? 'Fecha de aprobación'
      : 'Fecha de propuesta';

    // If isDefault=true, unmark all other defaults for this user
    if (input.isDefault) {
      const existing = await CommercialDashboardViews.findAll({
        filters: { isDefault: true },
      });
      const otherDefaults = existing.records.filter(v => {
        const ownerArr = Array.isArray(v.owner) ? v.owner : v.owner ? [v.owner] : [];
        return ownerArr.includes(userId);
      });
      for (const v of otherDefaults) {
        await CommercialDashboardViews.update({ id: v.id, record: { isDefault: false } });
      }
    }

    // Upsert by viewId
    if (input.viewId) {
      const existing = await CommercialDashboardViews.findOne({
        filters: { viewId: input.viewId },
      });
      if (existing) {
        await CommercialDashboardViews.update({
          id: existing.id,
          record: {
            viewName: input.viewName,
            filtersJson: input.filtersJson,
            widgetsJson: input.widgetsJson,
            dateReference: dateRefValue,
            isDefault: input.isDefault ?? existing.isDefault ?? false,
            isShared: input.isShared ?? existing.isShared ?? false,
            sortOrder: input.sortOrder ?? existing.sortOrder ?? 0,
          },
        });
        return { dbId: existing.id, viewId: input.viewId };
      }
    }

    // Create new
    const newViewId = input.viewId || `view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await CommercialDashboardViews.create({
      record: {
        viewName: input.viewName,
        viewId: newViewId,
        owner: userId,
        filtersJson: input.filtersJson,
        widgetsJson: input.widgetsJson,
        dateReference: dateRefValue,
        isDefault: input.isDefault ?? false,
        isShared: input.isShared ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });

    return { dbId: created.id, viewId: newViewId };
  },
});
