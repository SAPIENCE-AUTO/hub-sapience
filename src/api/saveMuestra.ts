import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { guardarMuestra, nombreDeUsuario } from '../serverUtils/muestra/muestra';
import { actualizarTablero } from '../serverUtils/formularios/tableroHub';

/**
 * Guarda la muestra como versión nueva, con sus cambios en palabras (los
 * calcula la pantalla, con su hora local) y el motivo. `soloLigas`: anota los
 * grupos y eventos que la pantalla acaba de crear, sin versión nueva.
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
    const version = await guardarMuestra({ ...input, motivo: input.motivo?.trim() || undefined, por });
    // Las cuotas de los perfiles salen de la muestra: los sugeridos de los tableros se recalculan (sin hacer esperar).
    if (!input.soloLigas) {
      pool.query(`select id from formularios where proyecto_id = $1 and vinculo is not null`, [input.proyectoId])
        .then(({ rows }) => Promise.all(rows.map((r) => actualizarTablero(r.id))))
        .catch((err) => console.error('[muestra] no se pudieron recalcular los sugeridos', (err as Error).message));
    }
    return { version };
  },
});
