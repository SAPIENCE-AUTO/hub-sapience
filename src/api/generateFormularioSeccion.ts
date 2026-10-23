import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { cargarFiltro, escribirSeccion } from '../serverUtils/formularios/generar';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Etapa 2 del generador con IA: escribe una sección de la estructura
 * aprobada, con ids definitivos y revisada. Queda guardada en el generador
 * (si se cierra la ventana no se pierde); la pone en el screener el editor.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Escribe con la IA una sección de un filtro según su estructura',
  inputSchema: z.object({ formularioId: z.string(), seccionId: z.string(), definicion: z.any() }),
  outputSchema: z.object({ seccion: z.any(), firma: z.string(), supuestos: z.array(z.string()), problemas: z.array(z.string()) }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    return escribirSeccion({ filtro, email: context.user!.email, stream, seccionId: input.seccionId, definicion: leerDefinicion(input.definicion) });
  },
});
