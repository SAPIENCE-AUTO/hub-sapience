import { z } from 'zod';
import { createEndpoint, Projects, Deals, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Find the project that corresponds to a deal — first via Projects.dealVinculado (ya vinculado formalmente), y si no hay nada, por coincidencia de nombre contra un proyecto existente (candidato a vincular, para no crear un duplicado al aprobar)',
  inputSchema: z.object({ dealId: z.string() }),
  outputSchema: z.object({
    project: z.object({ id: z.string(), projectCode: z.string().optional() }).nullable(),
    matchType: z.enum(['linked', 'candidate']).optional(),
  }),
  execute: async ({ input }) => {
    const { records } = await Projects.findAll({
      filters: { dealVinculado: { contains: input.dealId } } as any,
      fields: ['projectCode'],
      limit: 1,
    });
    const linked = records[0];
    if (linked) return { project: { id: linked.id, projectCode: linked.projectCode ?? undefined }, matchType: 'linked' as const };

    // Sin vínculo formal — ¿hay un proyecto con el mismo nombre? (mismo
    // criterio que approveDeal.ts usa para el projectCode nuevo, pero
    // buscando ANTES de crear, para no duplicar cuando el proyecto ya
    // existía de antes — p.ej. creado a mano, sin pasar por este flujo).
    const deal = await Deals.findOne({ id: input.dealId });
    if (!deal?.dealName) return { project: null };
    const { rows } = await pool.query(
      `select id, project_code from projects where lower(trim(project_code)) = lower(trim($1)) limit 1`,
      [deal.dealName],
    );
    const candidate = rows[0];
    if (!candidate) return { project: null };
    return { project: { id: candidate.id, projectCode: candidate.project_code ?? undefined }, matchType: 'candidate' as const };
  },
});
