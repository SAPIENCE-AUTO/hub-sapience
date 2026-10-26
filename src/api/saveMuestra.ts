import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { guardarMuestra, nombreDeUsuario } from '../serverUtils/muestra/muestra';

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
    return { version };
  },
});
