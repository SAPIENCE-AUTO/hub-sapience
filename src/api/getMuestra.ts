import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { avanceDeGrupos, insumosDelProyecto, muestraDeProyecto, perfilesDelProyecto, tablerosDelProyecto, versionesDe } from '../serverUtils/muestra/muestra';

/**
 * La muestra del proyecto (Reclutamiento → Muestra): sus actividades, sus
 * versiones, cuántas personas hay ya en el grupo de cada actividad y dónde se
 * pueden crear grupos y eventos. Por ahora solo para quien ve Filtros.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Lee la muestra de un proyecto con su avance',
  inputSchema: z.object({ proyectoId: z.string() }),
  outputSchema: z.object({
    muestra: z.object({
      id: z.string(), version: z.number(), definicion: z.any(),
      tableroId: z.string().optional(), calendarioId: z.string().optional(), updatedAt: z.string(),
    }).nullable(),
    versiones: z.array(z.object({ version: z.number(), cambios: z.array(z.string()), motivo: z.string().optional(), por: z.string().optional(), fecha: z.string() })),
    avance: z.record(z.string(), z.object({ total: z.number(), confirmados: z.number(), porEstatus: z.record(z.string(), z.number()) })),
    tableros: z.array(z.object({ id: z.string(), nombre: z.string() })),
    calendarios: z.array(z.object({ id: z.string(), nombre: z.string() })),
    perfiles: z.array(z.object({ nombre: z.string(), meta: z.number() })),
    hayInsumos: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const [muestra, { tableros, calendarios }, perfiles, insumos] = await Promise.all([
      muestraDeProyecto(input.proyectoId), tablerosDelProyecto(input.proyectoId), perfilesDelProyecto(input.proyectoId), insumosDelProyecto(input.proyectoId),
    ]);
    const grupos = (muestra?.definicion.actividades ?? []).flatMap((a) => (a.grupoId ? [a.grupoId] : []));
    const [versiones, avance] = await Promise.all([
      muestra ? versionesDe(muestra.id) : Promise.resolve([]),
      avanceDeGrupos(muestra?.tableroId, grupos),
    ]);
    return { muestra, versiones, avance, tableros, calendarios, perfiles, hayInsumos: !!insumos };
  },
});
