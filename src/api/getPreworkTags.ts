import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Lista los tags de Prework disponibles para un estudio',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: z.object({ tags: z.array(z.object({ id: z.string(), nombre: z.string(), color: z.string().optional() })) }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{ id: string; nombre: string; color: string | null }>(
      `select id, nombre, color from prework_tags where prework_estudio_id = $1 order by nombre`,
      [input.estudioId],
    );
    return { tags: rows.map(t => ({ id: t.id, nombre: t.nombre, color: t.color ?? undefined })) };
  },
});
