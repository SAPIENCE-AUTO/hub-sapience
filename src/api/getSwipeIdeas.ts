import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number(),
  tieneVotos: z.boolean(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Ideas de un capítulo de Swipe para el dashboard del facilitador (sin filtrar por estado)',
  inputSchema: z.object({ capituloId: z.string() }),
  outputSchema: z.object({ ideas: z.array(ideaSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select i.id, i.titulo, i.descripcion, i.imagen_url, i.orden,
              exists(select 1 from swipe_votos v where v.idea_id = i.id) as tiene_votos
       from swipe_ideas i where i.capitulo_id = $1 order by i.orden asc`,
      [input.capituloId],
    );
    return {
      ideas: result.rows.map((row) => ({
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        orden: Number(row.orden),
        tieneVotos: row.tiene_votos as boolean,
      })),
    };
  },
});
