import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { buscarEnCatalogo } from '../serverUtils/busqueda/buscar';
import { traducirFaltaTablasBusqueda } from '../serverUtils/busqueda/almacen';

const ValorDeGrupo = z.object({ valor: z.string(), etiqueta: z.string(), filas: z.number(), tableros: z.number() });
const ValorDeItem = z.object({ valor: z.string(), etiqueta: z.string(), filas: z.number(), primero: z.number().nullable() });
const Item = z.object({
  tableroId: z.string(),
  proyecto: z.string().nullable(),
  tablero: z.string(),
  cliente: z.string().nullable(),
  fechaInicio: z.string().nullable(),
  columnaId: z.string(),
  columna: z.string(),
  respondieron: z.number(),
  valores: z.array(ValorDeItem),
  filas: z.number(),
});
const Grupo = z.object({
  clave: z.string(),
  donde: z.enum(['columna', 'respuesta']),
  ejemplo: z.string(),
  tableros: z.number(),
  filas: z.number(),
  valores: z.array(ValorDeGrupo),
  items: z.array(Item),
});

/**
 * Dónde se preguntó por una marca o una palabra («corona», «levité») y qué respondió la gente, agrupado por cómo se preguntó, con los tableros de cada grupo. Solo lee el catálogo del buscador (nunca los
 * tableros): responde al instante.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Busca en el catálogo de preguntas y respuestas de los tableros dónde se preguntó por una marca o palabra',
  inputSchema: z.object({ termino: z.string().max(80) }),
  outputSchema: z.object({ termino: z.string(), recortado: z.boolean(), grupos: z.array(Grupo) }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    try {
      return await buscarEnCatalogo(pool, input.termino);
    } catch (err) {
      return traducirFaltaTablasBusqueda(err);
    }
  },
});
