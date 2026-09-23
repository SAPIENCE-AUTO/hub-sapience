import { z } from 'zod';
import { createEndpoint, Projects, ZiteError } from '../../server/compat';

// Quién puede decidir qué rubros de presupuesto quedan visibles al vincular
// un proyecto a un deal — el vínculo simple (dealId, sin rubros) lo sigue
// pudiendo hacer cualquiera con acceso a la herramienta de costos de
// Finanzas (ProjectCostRow.tsx), sin cambio; solo el paso nuevo de
// visibilidad granular por rubro es exclusivo de Sergio.
const RUBRO_VISIBILITY_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export default createEndpoint({
  authenticated: true,
  description: 'Link or unlink a deal from a project for P&L cost analysis, optionally setting which budget rubros are visible',
  inputSchema: z.object({
    projectId: z.string(),
    dealId: z.string().optional(), // omit to unlink
    visibleRubros: z.array(z.string()).optional(), // omitir = no tocar la configuración existente; solo Sergio puede mandarlo
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const record: Record<string, unknown> = { dealVinculado: input.dealId ? [input.dealId] : [] };

    if (input.visibleRubros !== undefined) {
      if (!RUBRO_VISIBILITY_ALLOWED_EMAILS.includes(context.user?.email ?? '')) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo Sergio puede configurar qué rubros de presupuesto son visibles.' });
      }
      record.visibleBudgetRubros = JSON.stringify(input.visibleRubros);
    }

    await Projects.update({ id: input.projectId, record: record as any });
    return { success: true };
  },
});
