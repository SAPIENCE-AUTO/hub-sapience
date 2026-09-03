import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const votoSchema = z.object({
  id: z.string(),
  alias: z.string(),
  valor: z.string(),
  msDecision: z.number().optional(),
  createdAt: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Quién votó y cómo en una idea de Swipe, para el dashboard del facilitador',
  inputSchema: z.object({ ideaId: z.string() }),
  outputSchema: z.object({ votos: z.array(votoSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select v.id, p.alias, v.valor, v.ms_decision, v.created_at
       from swipe_votos v
       join swipe_participantes p on p.id = v.participante_id
       where v.idea_id = $1
       order by v.created_at asc`,
      [input.ideaId],
    );
    return {
      votos: result.rows.map((row) => ({
        id: row.id as string,
        alias: row.alias as string,
        valor: row.valor as string,
        msDecision: (row.ms_decision ?? undefined) as number | undefined,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  },
});
