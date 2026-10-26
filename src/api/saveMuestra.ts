import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { guardarMuestra, muestraDeProyecto, nombreDeUsuario, nombresAlTablero } from '../serverUtils/muestra/muestra';
import { perfilesALosFiltros } from '../serverUtils/muestra/filtros';
import { actualizarTablero } from '../serverUtils/formularios/tableroHub';
import { leerMuestra } from '../lib/reclutamiento/muestra';

/**
 * Guarda la muestra como versión nueva, con sus cambios en palabras (los
 * calcula la pantalla, con su hora local) y el motivo. `soloLigas`: anota los
 * grupos y eventos que la pantalla acaba de crear, sin versión nueva. Los
 * filtros del proyecto toman el nombre y la cuota de los perfiles, y los grupos
 * que ya existen, su nombre nuevo (los eventos los pone al día la pantalla).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda la muestra de un proyecto',
  inputSchema: z.object({
    proyectoId: z.string(),
    definicion: z.any(),
    cambios: z.array(z.string()).max(200),
    motivo: z.string().max(1000).optional(),
    versionBase: z.number(),
    tableroId: z.string().optional(),
    calendarioId: z.string().optional(),
    soloLigas: z.boolean().optional(),
  }),
  outputSchema: z.object({ version: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const por = await nombreDeUsuario(context.user!.email);
    const antes = input.soloLigas ? null : await muestraDeProyecto(input.proyectoId);
    const version = await guardarMuestra({ ...input, motivo: input.motivo?.trim() || undefined, por });
    if (!input.soloLigas) {
      const nueva = leerMuestra(input.definicion);
      // Los perfiles y cuotas viven en la muestra: los filtros los toman ya.
      await perfilesALosFiltros(input.proyectoId, nueva, antes?.definicion);
      await nombresAlTablero(antes?.definicion, nueva, antes?.tableroId);
      // Y los sugeridos de los tableros se recalculan con las cuotas nuevas (sin hacer esperar).
      pool.query(`select id from formularios where proyecto_id = $1 and vinculo is not null`, [input.proyectoId])
        .then(({ rows }) => Promise.all(rows.map((r) => actualizarTablero(r.id))))
        .catch((err) => console.error('[muestra] no se pudieron recalcular los sugeridos', (err as Error).message));
    }
    return { version };
  },
});
