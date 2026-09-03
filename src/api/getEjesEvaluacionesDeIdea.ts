import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const evaluacionSchema = z.object({
  alias: z.string(),
  valorX: z.number(),
  valorY: z.number(),
  createdAt: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Quién evaluó y en qué punto una idea de Ejes, para el dashboard del facilitador',
  inputSchema: z.object({ ideaId: z.string() }),
  outputSchema: z.object({ evaluaciones: z.array(evaluacionSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select p.alias, e.valor_x, e.valor_y, e.created_at
       from ejes_evaluaciones e
       join ejes_participantes p on p.id = e.participante_id
       where e.idea_id = $1
       order by e.created_at asc`,
      [input.ideaId],
    );
    return {
      evaluaciones: result.rows.map((row) => ({
        alias: row.alias as string,
        valorX: Number(row.valor_x),
        valorY: Number(row.valor_y),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  },
});
