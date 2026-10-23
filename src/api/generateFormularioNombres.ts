import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { cargarFiltro, proponerNombres } from '../serverUtils/formularios/generar';
import { leerDefinicion } from '../lib/formularios/tipos';

/**
 * Nombres cortos (los de las columnas del tablero) para las preguntas que no
 * tienen, con la IA. Devuelve id → nombre sin aplicarlos: los pone el editor.
 */
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Propone con la IA los nombres cortos de las preguntas de un filtro que no tienen',
  inputSchema: z.object({
    formularioId: z.string(),
    definicion: z.any(),
  }),
  outputSchema: z.object({
    nombres: z.record(z.string(), z.string()),
  }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoFormularios(context);
    const filtro = await cargarFiltro(input.formularioId);
    return proponerNombres({ filtro, email: context.user!.email, stream, definicion: leerDefinicion(input.definicion) });
  },
});
