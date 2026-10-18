import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { MONEDAS } from '../lib/pagosManagement/reparto';
import { exigirAccesoPagosManagement } from '../serverUtils/pagosManagement/acceso';
import { listarPagosManagement } from '../serverUtils/pagosManagement/servicio';

const Moneda = z.enum(MONEDAS);

/** Pagos de análisis / management: los proyectos con su monto de management y el reparto entre personas — solo Sergio. */
export default createEndpoint({
  authenticated: true,
  description: 'Pagos de análisis/management: proyectos con su monto de management y el reparto entre personas — solo Sergio',
  inputSchema: z.object({}),
  outputSchema: z.object({
    proyectos: z.array(z.object({
      repartoId: z.string().nullable(),
      projectId: z.string().nullable(),
      codigo: z.string(),
      nombre: z.string().optional(),
      cliente: z.string().optional(),
      estado: z.string().optional(),
      inicio: z.string().optional(),
      dealNombre: z.string().optional(),
      montoDeal: z.number(),
      montoDealConMarkup: z.number(),
      monedaDeal: Moneda,
      presupuesto: z.number().nullable(),
      moneda: Moneda,
      personas: z.array(z.object({ id: z.string().optional(), userId: z.string().nullable(), nombre: z.string(), externo: z.boolean(), porcentaje: z.number() })),
      eliminado: z.boolean(),
    })),
    disponibles: z.array(z.object({
      projectId: z.string(),
      codigo: z.string(),
      nombre: z.string().optional(),
      cliente: z.string().optional(),
      estado: z.string().optional(),
      inicio: z.string().optional(),
      dealNombre: z.string().optional(),
      monedaDeal: Moneda,
    })),
    usuarios: z.array(z.object({ id: z.string(), nombre: z.string(), departamento: z.string().optional() })),
    externos: z.array(z.string()),
    sinTablas: z.boolean(),
  }),
  execute: async ({ context }) => {
    exigirAccesoPagosManagement(context);
    return listarPagosManagement();
  },
});
