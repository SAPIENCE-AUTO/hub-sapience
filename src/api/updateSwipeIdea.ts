import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

/**
 * Editar una idea solo tiene sentido antes de que alguien ya haya votado
 * sobre ella — cambiar el título/imagen después haría que los votos ya
 * emitidos queden opinando sobre algo distinto de lo que se les mostró.
 * Se valida aquí (no solo escondiendo el botón en el front) porque es la
 * garantía real de integridad de los resultados.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Edita una idea de Swipe — solo si todavía no tiene votos',
  inputSchema: z.object({
    ideaId: z.string(),
    titulo: z.string().min(1).max(60),
    descripcion: z.string().max(180).optional(),
    imagenUrl: z.string().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const votos = await pool.query(`select 1 from swipe_votos where idea_id = $1 limit 1`, [input.ideaId]);
    if (votos.rows.length > 0) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Esta idea ya tiene votos — no se puede editar.' });
    }
    await pool.query(
      `update swipe_ideas set titulo = $1, descripcion = $2, imagen_url = $3 where id = $4`,
      [input.titulo, input.descripcion ?? null, input.imagenUrl ?? null, input.ideaId],
    );
    return { ok: true };
  },
});
