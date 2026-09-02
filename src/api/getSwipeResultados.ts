import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaResultadoSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  imagenUrl: z.string().optional(),
  totalVotos: z.number(),
  potencial: z.number(),
  descarte: z.number(),
  pctPotencial: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Resultados agregados (ranking) de un capítulo de Swipe para el dashboard del facilitador',
  inputSchema: z.object({ capituloId: z.string() }),
  outputSchema: z.object({
    totalParticipantesVotaron: z.number(),
    ideas: z.array(ideaResultadoSchema),
  }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select
         i.id, i.titulo, i.imagen_url,
         count(v.id) filter (where v.valor is not null) as total_votos,
         count(v.id) filter (where v.valor = 'potencial') as potencial,
         count(v.id) filter (where v.valor = 'descarte') as descarte
       from swipe_ideas i
       left join swipe_votos v on v.idea_id = i.id
       where i.capitulo_id = $1
       group by i.id
       order by i.orden asc`,
      [input.capituloId],
    );

    const participantesResult = await pool.query(
      `select count(distinct v.participante_id) as n
       from swipe_votos v
       join swipe_ideas i on i.id = v.idea_id
       where i.capitulo_id = $1`,
      [input.capituloId],
    );

    const ideas = result.rows
      .map((row) => {
        const potencial = Number(row.potencial ?? 0);
        const descarte = Number(row.descarte ?? 0);
        const totalVotos = Number(row.total_votos ?? 0);
        const base = potencial + descarte;
        return {
          id: row.id as string,
          titulo: row.titulo as string,
          imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
          totalVotos,
          potencial,
          descarte,
          pctPotencial: base > 0 ? Math.round((potencial / base) * 100) : 0,
        };
      })
      .sort((a, b) => b.pctPotencial - a.pctPotencial);

    return {
      totalParticipantesVotaron: Number(participantesResult.rows[0]?.n ?? 0),
      ideas,
    };
  },
});
