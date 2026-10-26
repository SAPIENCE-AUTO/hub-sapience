import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { conLatido } from '../serverUtils/formularios/claude';
import { proponerMuestra } from '../serverUtils/muestra/muestra';

/**
 * La IA propone la muestra con los insumos del filtro del proyecto. No la
 * guarda: la pantalla la muestra para revisarla. Con avance, para que la
 * conexión no se corte mientras la IA lee la propuesta.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Propone la muestra de un proyecto con la IA',
  inputSchema: z.object({ proyectoId: z.string() }),
  outputSchema: z.object({ definicion: z.any() }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const definicion = await conLatido(stream, 'La IA está leyendo los insumos…', () => proponerMuestra(input.proyectoId, context.user!.email));
    return { definicion };
  },
});
