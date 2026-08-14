import { z } from 'zod';
import { createEndpoint, Projects } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Find the project linked to a deal (via Projects.dealVinculado) — Deals has no reverse "projects" column, so this is the only reliable way to check',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({
    project: z.object({ id: z.string(), projectCode: z.string().optional() }).nullable(),
  }),
  execute: async ({ input }) => {
    const { records } = await Projects.findAll({
      filters: { dealVinculado: { contains: input.dealId } } as any,
      fields: ['projectCode'],
      limit: 1,
    });
    const p = records[0];
    return { project: p ? { id: p.id, projectCode: p.projectCode ?? undefined } : null };
  },
});
