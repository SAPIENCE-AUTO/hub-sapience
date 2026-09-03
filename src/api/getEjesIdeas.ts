import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number(),
  tieneEvaluaciones: z.boolean(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Ideas de un tablero de Ejes para el dashboard del facilitador (sin filtrar por estado)',
  inputSchema: z.object({ tableroId: z.string() }),
  outputSchema: z.object({ ideas: z.array(ideaSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select i.id, i.titulo, i.descripcion, i.imagen_url, i.orden,
              exists(select 1 from ejes_evaluaciones e where e.idea_id = i.id) as tiene_evaluaciones
       from ejes_ideas i where i.tablero_id = $1 order by i.orden asc`,
      [input.tableroId],
    );
    return {
      ideas: result.rows.map((row) => ({
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        orden: Number(row.orden),
        tieneEvaluaciones: row.tiene_evaluaciones as boolean,
      })),
    };
  },
});
