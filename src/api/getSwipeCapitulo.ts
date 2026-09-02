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
  authenticated: false,
  description: 'Ideas de un capítulo de Swipe para el participante — solo si el capítulo está abierto',
  inputSchema: z.object({ capituloId: z.string(), participanteId: z.string().optional() }),
  outputSchema: z.object({
    found: z.boolean(),
    nombre: z.string().optional(),
    descripcion: z.string().optional(),
    ideas: z.array(ideaSchema).optional(),
    superLikesRestantes: z.number().optional(),
  }),
  execute: async ({ input }) => {
    const capResult = await pool.query(
      `select c.id, c.nombre, c.descripcion, s.max_super_likes
       from swipe_capitulos c join swipe_sesiones s on s.id = c.sesion_id
       where c.id = $1 and c.estado = 'abierto'`,
      [input.capituloId],
    );
    const cap = capResult.rows[0];
    if (!cap) return { found: false };

    const ideasResult = await pool.query(
      `select id, titulo, descripcion, imagen_url, orden from swipe_ideas where capitulo_id = $1 order by orden asc`,
      [input.capituloId],
    );

    // Límite es por participante, por capítulo (spec §3) — se recalcula
    // contando los votos 'super' ya emitidos en las ideas de este capítulo,
    // no un contador aparte que se pudiera desincronizar.
    let superLikesRestantes = cap.max_super_likes as number;
    if (input.participanteId) {
      const usadosResult = await pool.query(
        `select count(*) as n from swipe_votos v
         join swipe_ideas i on i.id = v.idea_id
         where i.capitulo_id = $1 and v.participante_id = $2 and v.valor = 'super'`,
        [input.capituloId, input.participanteId],
      );
      superLikesRestantes = Math.max(0, cap.max_super_likes - Number(usadosResult.rows[0].n));
    }

    return {
      found: true,
      nombre: cap.nombre as string,
      descripcion: (cap.descripcion ?? undefined) as string | undefined,
      ideas: ideasResult.rows.map((row) => ({
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        orden: Number(row.orden),
      })),
      superLikesRestantes,
    };
  },
});
