import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

/**
 * Editar una idea solo tiene sentido antes de que alguien ya haya
 * evaluado sobre ella — mismo razonamiento que updateSwipeIdea.ts.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Edita una idea de Ejes — solo si todavía no tiene evaluaciones',
  inputSchema: z.object({
    ideaId: z.string(),
    titulo: z.string().min(1).max(60),
    descripcion: z.string().max(180).optional(),
    imagenUrl: z.string().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const evaluaciones = await pool.query(`select 1 from ejes_evaluaciones where idea_id = $1 limit 1`, [input.ideaId]);
    if (evaluaciones.rows.length > 0) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Esta idea ya tiene evaluaciones — no se puede editar.' });
    }
    await pool.query(
      `update ejes_ideas set titulo = $1, descripcion = $2, imagen_url = $3 where id = $4`,
      [input.titulo, input.descripcion ?? null, input.imagenUrl ?? null, input.ideaId],
    );
    return { ok: true };
  },
});
