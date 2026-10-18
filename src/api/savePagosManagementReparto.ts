import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { MAX_PERSONAS, MAX_PORCENTAJE, MONEDAS, RUBROS } from '../lib/pagosManagement/reparto';
import { exigirAccesoPagosManagement } from '../serverUtils/pagosManagement/acceso';
import { guardarReparto } from '../serverUtils/pagosManagement/servicio';

/**
 * Guarda el reparto de un proyecto: los rubros que forman el presupuesto (cada uno con su monto, o null = el que dice el deal) y las personas con
 * su porcentaje. Reemplaza lo anterior. Con solo el Management del deal sin tocar y sin personas, quita el reparto del proyecto.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda el reparto del presupuesto de un proyecto entre personas — solo Sergio',
  inputSchema: z.object({
    projectId: z.string().uuid(),
    rubros: z.array(z.object({ rubro: z.enum(RUBROS), monto: z.number().min(0).max(1_000_000_000).nullable() })).min(1).max(RUBROS.length),
    moneda: z.enum(MONEDAS).nullable(),
    personas: z.array(z.object({
      userId: z.string().uuid().nullable(),
      nombre: z.string().max(120),
      externo: z.boolean(),
      porcentaje: z.number().gt(0).max(MAX_PORCENTAJE),
    })).max(MAX_PERSONAS),
  }),
  outputSchema: z.object({ ok: z.boolean(), eliminado: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoPagosManagement(context);
    const { eliminado } = await guardarReparto(input, context.user?.email ?? '');
    return { ok: true, eliminado };
  },
});
