import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { cargarFiltro, proponerCambio } from '../serverUtils/formularios/generar';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Un cambio pedido con palabras: el botón IA de una pregunta o el comentario
 * a la lógica de una sección (o de los frentes). Devuelve la propuesta sin
 * aplicarla: el parche con ids definitivos, qué cambia en palabras, qué
 * lógica rompe y lo que haya quedado mal armado. La aplica el editor.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Propone con la IA un cambio a una pregunta, a una sección o a los frentes de un filtro',
  inputSchema: z.object({
    formularioId: z.string(),
    definicion: z.any(),
    alcance: z.union([z.object({ pregunta: z.string() }), z.object({ seccion: z.string() }), z.object({ frentes: z.literal(true) })]),
    pedido: z.string().min(1).max(5_000),
  }),
  outputSchema: z.object({
    parche: z.any(),
    explicacion: z.string(),
    cambios: z.array(z.string()),
    avisos: z.array(z.string()),
    problemas: z.array(z.string()),
  }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    return proponerCambio({
      filtro, email: context.user!.email, stream, definicion: leerDefinicion(input.definicion), alcance: input.alcance, pedido: input.pedido.trim(),
    });
  },
});
