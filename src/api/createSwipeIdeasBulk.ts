import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/** Alta rápida: varias ideas de un jalón (el front ya las separó por línea, o las leyó de imágenes arrastradas), para no abrir el diálogo de "Nueva idea" N veces. */
export default createEndpoint({
  authenticated: true,
  description: 'Da de alta varias ideas de Swipe de un jalón dentro de un capítulo',
  inputSchema: z.object({
    capituloId: z.string(),
    ideas: z.array(z.object({
      titulo: z.string().min(1).max(60),
      descripcion: z.string().max(180).optional(),
      imagenUrl: z.string().optional(),
    })).min(1).max(50),
  }),
  outputSchema: z.object({ creadas: z.number(), ids: z.array(z.string()) }),
  execute: async ({ input }) => {
    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from swipe_ideas where capitulo_id = $1`,
      [input.capituloId],
    );
    let orden = ordenResult.rows[0].siguiente as number;

    const ids: string[] = [];
    for (const idea of input.ideas) {
      const insertada = await pool.query(
        `insert into swipe_ideas (capitulo_id, titulo, descripcion, imagen_url, orden) values ($1, $2, $3, $4, $5) returning id`,
        [input.capituloId, idea.titulo, idea.descripcion ?? null, idea.imagenUrl ?? null, orden],
      );
      ids.push(String(insertada.rows[0].id));
      orden += 1;
    }
    return { creadas: ids.length, ids };
  },
});
