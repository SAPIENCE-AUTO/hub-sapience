import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoBuscador } from '../serverUtils/busqueda/acceso';
import { estadoDelCatalogo } from '../serverUtils/busqueda/buscar';

/** Qué sabe el buscador de gente: cuántos tableros, preguntas y respuestas tiene y de cuándo es. Si todavía no se crean las tablas, lo dice sin fallar. */
export default createEndpoint({
  authenticated: true,
  description: 'Estado del catálogo del buscador de gente (tableros, preguntas y respuestas leídos, y de cuándo)',
  inputSchema: z.object({}),
  outputSchema: z.object({
    existe: z.boolean(),
    tableros: z.number(),
    preguntas: z.number(),
    respuestas: z.number(),
    actualizado: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    exigirAccesoBuscador(context);
    return estadoDelCatalogo(pool);
  },
});
