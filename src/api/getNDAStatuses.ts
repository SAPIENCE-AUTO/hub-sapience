import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { estadosDeProyecto } from '../serverUtils/nda/servicio';

// Lo que pinta la columna «NDA» de Reclutamiento: el último envío de cada fila del proyecto. Si las tablas del NDA todavía no existen devuelve vacío (la tabla muestra el botón de siempre).
export default createEndpoint({
  authenticated: true,
  description: 'Latest NDA status per recruitment row of a project (sent / opened / signed / rejected)',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({
    items: z.array(z.object({
      rowId: z.string(),
      envioId: z.string(),
      estado: z.enum(['enviado', 'abierto', 'firmado', 'rechazado']),
      enviadoAt: z.string().optional(),
      abiertoAt: z.string().optional(),
      firmadoAt: z.string().optional(),
      rechazadoAt: z.string().optional(),
      tienePdf: z.boolean(),
      sesionAt: z.string().optional(),
      sesionLugar: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    try {
      return { items: await estadosDeProyecto(input.projectCode) };
    } catch (e) {
      if (/nda_envios/.test((e as Error).message) && /does not exist|no existe/i.test((e as Error).message)) return { items: [] };
      throw e;
    }
  },
});
