import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { cambiarInsumos, insumosParaNavegador } from '../serverUtils/muestra/insumos';

/**
 * Los insumos de la muestra (Reclutamiento → Muestra): el texto del equipo,
 * las reuniones de Notetaker y los archivos (uno por llamada, en base64: PDF,
 * PowerPoint, Word, Excel o imagen). La primera vez se copian los del filtro.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Suma o quita insumos de la muestra de un proyecto',
  inputSchema: z.object({
    proyectoId: z.string(),
    notas: z.string().max(100_000).optional(),
    reuniones: z.array(z.object({ id: z.string(), titulo: z.string(), fecha: z.string().optional() })).optional(),
    archivo: z.object({ nombre: z.string(), mime: z.string(), base64: z.string() }).optional(),
    quitarArchivo: z.string().optional(),
  }),
  outputSchema: z.object({ insumos: z.any() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { proyectoId, ...cambio } = input;
    return { insumos: insumosParaNavegador(await cambiarInsumos(proyectoId, cambio, context.user!.email)) };
  },
});
