import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { aprobarEstructura, cargarFiltro, descartarPropuesta, generadorParaNavegador, guardarGenerador } from '../serverUtils/formularios/generar';

/**
 * Lo que se decide en pantalla sobre el generador (fase 3 de Filtros):
 * aprobar la estructura para escribir las preguntas, corregir a mano el
 * nombre y la cuota de un frente de la estructura, marcar los supuestos como
 * revisados, dejar un filtro anterior tal cual sin pasar por la IA, o
 * descartar una propuesta de cambio de estructura.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Aprueba la estructura, corrige frentes o marca los supuestos revisados en el generador de un filtro',
  inputSchema: z.object({
    formularioId: z.string(),
    aprobar: z.boolean().optional(),
    supuestosRevisados: z.boolean().optional(),
    frente: z.object({ id: z.string(), nombre: z.string().min(1).optional(), meta: z.number().int().min(1).optional() }).optional(),
    usarTalCual: z.boolean().optional(),
    /** Descartar una propuesta de cambio de estructura de un filtro ya escrito. */
    descartar: z.boolean().optional(),
  }),
  outputSchema: z.object({ generador: z.any(), salen: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    if (!filtro.generador) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este filtro no se hizo con el generador.' });
    if (input.descartar) return { generador: generadorParaNavegador(await descartarPropuesta(filtro)), salen: [] };
    if (input.aprobar) {
      const r = await aprobarEstructura(filtro);
      return { generador: generadorParaNavegador(r.generador), salen: r.salen };
    }
    const g = { ...filtro.generador };
    if (input.supuestosRevisados !== undefined) g.supuestosRevisados = input.supuestosRevisados;
    if (input.usarTalCual) g.etapa = 'listo';
    if (input.frente && g.estructura) {
      const { id, ...cambio } = input.frente;
      g.estructura = { ...g.estructura, frentes: g.estructura.frentes.map((f) => (f.id === id ? { ...f, ...cambio } : f)) };
    }
    await guardarGenerador(filtro.id, g);
    return { generador: generadorParaNavegador(g), salen: [] };
  },
});
