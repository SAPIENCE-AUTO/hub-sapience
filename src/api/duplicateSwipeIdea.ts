import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Duplicar nunca toca los votos del original (crea una idea nueva, sin
 * historial) — a diferencia de editar/borrar, es seguro incluso si la idea
 * original ya tiene votos.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Duplica una idea de Swipe dentro del mismo capítulo',
  inputSchema: z.object({ ideaId: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const ideaResult = await pool.query(
      `select capitulo_id, titulo, descripcion, imagen_url from swipe_ideas where id = $1`,
      [input.ideaId],
    );
    const idea = ideaResult.rows[0];
    if (!idea) throw new Error('Idea no encontrada');

    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from swipe_ideas where capitulo_id = $1`,
      [idea.capitulo_id],
    );
    const orden = ordenResult.rows[0].siguiente as number;

    const nuevoTitulo = `${idea.titulo} (copia)`.slice(0, 60);
    const result = await pool.query(
      `insert into swipe_ideas (capitulo_id, titulo, descripcion, imagen_url, orden) values ($1, $2, $3, $4, $5) returning id`,
      [idea.capitulo_id, nuevoTitulo, idea.descripcion, idea.imagen_url, orden],
    );
    return { id: result.rows[0].id as string };
  },
});
