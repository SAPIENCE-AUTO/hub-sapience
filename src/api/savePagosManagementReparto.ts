import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { MAX_PERSONAS, MONEDAS } from '../lib/pagosManagement/reparto';
import { exigirAccesoPagosManagement } from '../serverUtils/pagosManagement/acceso';
import { guardarReparto } from '../serverUtils/pagosManagement/servicio';

/**
 * Guarda el reparto del management de un proyecto: el presupuesto (null = el del deal) y las personas con su porcentaje. Reemplaza lo anterior.
 * Sin presupuesto a mano y sin personas, quita el reparto del proyecto.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda el reparto del management de un proyecto entre personas — solo Sergio',
  inputSchema: z.object({
    projectId: z.string().uuid(),
    presupuesto: z.number().min(0).max(1_000_000_000).nullable(),
    moneda: z.enum(MONEDAS).nullable(),
    personas: z.array(z.object({
      userId: z.string().uuid().nullable(),
      nombre: z.string().max(120),
      externo: z.boolean(),
      porcentaje: z.number().gt(0).max(100),
    })).max(MAX_PERSONAS),
  }),
  outputSchema: z.object({ ok: z.boolean(), eliminado: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoPagosManagement(context);
    const { eliminado } = await guardarReparto(input, context.user?.email ?? '');
    return { ok: true, eliminado };
  },
});
