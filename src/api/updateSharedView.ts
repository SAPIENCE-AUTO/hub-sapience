import { z } from 'zod';
import { createEndpoint, SharedViews } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Updates an existing shared view (name, filters, visible columns)',
  inputSchema: z.object({
    id: z.string(),
    viewName: z.string().optional(),
    filtersJson: z.string().optional(),
    visibleColumnsJson: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const record: Record<string, unknown> = {};
    if (input.viewName !== undefined) record.viewName = input.viewName;
    if (input.filtersJson !== undefined) record.filtersJson = input.filtersJson;
    if (input.visibleColumnsJson !== undefined) record.visibleColumnsJson = input.visibleColumnsJson;

    await SharedViews.update({ id: input.id, record });
    return { success: true };
  },
});
