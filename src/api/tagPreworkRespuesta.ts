import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Alterna un tag en una respuesta: lo crea si no existe (para este estudio), y quita/pone el join. */
export default createEndpoint({
  authenticated: true,
  description: 'Agrega o quita un tag de una respuesta de Prework (crea el tag si no existía)',
  inputSchema: z.object({
    respuestaId: z.string(),
    estudioId: z.string(),
    nombre: z.string().min(1),
    color: z.string().optional(),
  }),
  outputSchema: z.object({ tagged: z.boolean(), tagId: z.string() }),
  execute: async ({ input }) => {
    const { rows: existingTag } = await pool.query<{ id: string }>(
      `select id from prework_tags where prework_estudio_id = $1 and lower(nombre) = lower($2) limit 1`,
      [input.estudioId, input.nombre],
    );

    let tagId = existingTag[0]?.id;
    if (!tagId) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into prework_tags (prework_estudio_id, nombre, color) values ($1, $2, $3) returning id`,
        [input.estudioId, input.nombre.trim(), input.color ?? null],
      );
      tagId = rows[0].id;
    }

    const { rows: existingLink } = await pool.query(
      `select 1 from prework_respuesta_tags where respuesta_id = $1 and tag_id = $2`,
      [input.respuestaId, tagId],
    );

    if (existingLink.length > 0) {
      await pool.query(`delete from prework_respuesta_tags where respuesta_id = $1 and tag_id = $2`, [input.respuestaId, tagId]);
      return { tagged: false, tagId };
    }

    await pool.query(
      `insert into prework_respuesta_tags (respuesta_id, tag_id) values ($1, $2) on conflict do nothing`,
      [input.respuestaId, tagId],
    );
    return { tagged: true, tagId };
  },
});
