import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { cargarFiltro, generadorParaNavegador, proponerEstructura } from '../serverUtils/formularios/generar';
import { leerDefinicion } from '../lib/formularios/tipos';
import { nombreDeUsuario, proponerMuestraSiNoHay } from '../serverUtils/muestra/muestra';

/**
 * Etapa 1 del generador con IA (fase 3 de Filtros): propone la estructura
 * (país, perfil, frentes, secciones en orden de embudo y supuestos) a partir
 * de los insumos, convierte un screener en Word, adapta un filtro anterior o
 * ajusta la estructura de lo ya escrito con un comentario. Streaming solo
 * para mostrar avance y mantener viva la conexión: la IA tarda.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Propone o ajusta la estructura de un filtro con la IA',
  inputSchema: z.object({
    formularioId: z.string(),
    pedido: z.string().max(20_000).optional(),
    /** Ajustar con un comentario la estructura propuesta o la de lo ya escrito. */
    sobre: z.enum(['propuesta', 'escrito']).optional(),
    /** Con `sobre: 'escrito'`: el screener como está en el editor. */
    definicion: z.any().optional(),
  }),
  outputSchema: z.object({ generador: z.any(), problemas: z.array(z.string()) }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    const r = await proponerEstructura({
      filtro, email: context.user!.email, stream, pedido: input.pedido,
      ajuste: input.sobre === 'escrito' ? { sobre: 'escrito', definicion: leerDefinicion(input.definicion) } : input.sobre === 'propuesta' ? { sobre: 'propuesta' } : undefined,
    });
    // Con la primera estructura, la IA también propone la muestra del proyecto (si aún no tiene), con los
    // perfiles y cuotas de esta estructura, sin hacer esperar.
    if (!input.sobre) {
      const email = context.user!.email;
      const fijos = (r.generador.estructura?.frentes ?? []).map((f) => ({ nombre: f.nombre, descripcion: f.quien || undefined, cuota: f.meta }));
      nombreDeUsuario(email).then((por) => proponerMuestraSiNoHay(filtro.proyectoId, email, por, fijos)).catch((err) => console.error('[muestra] no se pudo proponer al armar el filtro', (err as Error).message));
    }
    return { generador: generadorParaNavegador(r.generador), problemas: r.problemas };
  },
});
