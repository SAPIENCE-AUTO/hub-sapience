import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { conLatido } from '../serverUtils/formularios/claude';
import { comentarMuestra } from '../serverUtils/muestra/muestra';
import { leerMuestra } from '../lib/reclutamiento/muestra';

/**
 * Un cambio a la muestra pedido con palabras a la IA, sobre la que se está
 * editando (guardada o no). No guarda: la pantalla enseña qué cambió y se
 * puede deshacer. Con avance, para que la conexión no se corte.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Cambia la muestra de un proyecto con un comentario a la IA',
  inputSchema: z.object({ proyectoId: z.string(), definicion: z.any(), comentario: z.string().min(1).max(4000) }),
  outputSchema: z.object({ definicion: z.any(), nota: z.string().optional() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    return conLatido(stream, 'La IA está haciendo el cambio…', () => comentarMuestra(input.proyectoId, leerMuestra(input.definicion), input.comentario.trim(), context.user!.email));
  },
});
