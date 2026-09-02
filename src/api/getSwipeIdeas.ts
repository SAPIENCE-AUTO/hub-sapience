import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Ideas de un capítulo de Swipe para el dashboard del facilitador (sin filtrar por estado)',
  inputSchema: z.object({ capituloId: z.string() }),
  outputSchema: z.object({ ideas: z.array(ideaSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select id, titulo, descripcion, imagen_url, orden from swipe_ideas where capitulo_id = $1 order by orden asc`,
      [input.capituloId],
    );
    return {
      ideas: result.rows.map((row) => ({
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        orden: Number(row.orden),
      })),
    };
  },
});
