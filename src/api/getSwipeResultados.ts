import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { medianaDe, clasificarQuadrante } from '../serverUtils/swipeQuadrante';

const ideaResultadoSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  totalVotos: z.number(),
  potencial: z.number(),
  descarte: z.number(),
  superLikes: z.number(),
  pctPotencial: z.number(),
  score: z.number(),
  avgMsDecision: z.number().optional(),
  quadrante: z.enum(['consenso_rapido', 'convence_cuesta', 'rechazo_inmediato', 'duda_genuina']).optional(),
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
      // Un super like también cuenta como "potencial" para el % (swipe
      // arriba es una forma de decir que sí, con más entusiasmo — no una
      // tercera categoría aparte de aprobar/descartar, spec §2), y además
      // se cuenta solo para el bono de score y para mostrarlo aparte.
      `select
         i.id, i.titulo, i.descripcion, i.imagen_url,
         count(v.id) filter (where v.valor is not null) as total_votos,
         count(v.id) filter (where v.valor in ('potencial', 'super')) as potencial,
         count(v.id) filter (where v.valor = 'descarte') as descarte,
         count(v.id) filter (where v.valor = 'super') as super_likes,
         avg(v.ms_decision) filter (where v.ms_decision is not null) as avg_ms_decision
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
    const totalParticipantesVotaron = Number(participantesResult.rows[0]?.n ?? 0);

    const preliminar = result.rows.map((row) => {
      const potencial = Number(row.potencial ?? 0);
      const descarte = Number(row.descarte ?? 0);
      const superLikes = Number(row.super_likes ?? 0);
      const totalVotos = Number(row.total_votos ?? 0);
      const base = potencial + descarte;
      const pctPotencial = base > 0 ? Math.round((potencial / base) * 100) : 0;
      // Score sugerido del spec §6: % potencial + (super_likes / participantes × 0.5),
      // en la misma escala 0-100 que pctPotencial (el 0.5 de peso se traduce a 50 puntos).
      const score = pctPotencial + (totalParticipantesVotaron > 0 ? (superLikes / totalParticipantesVotaron) * 50 : 0);
      return {
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        totalVotos,
        potencial,
        descarte,
        superLikes,
        pctPotencial,
        score: Math.round(score),
        avgMsDecision: row.avg_ms_decision != null ? Number(row.avg_ms_decision) : undefined,
      };
    });

    const medianaMs = medianaDe(preliminar.map((i) => i.avgMsDecision).filter((v): v is number => v !== undefined));
    const ideas = preliminar
      .map((idea) => ({ ...idea, quadrante: clasificarQuadrante(idea.pctPotencial, idea.avgMsDecision, medianaMs) }))
      .sort((a, b) => b.score - a.score);

    return { totalParticipantesVotaron, ideas };
  },
});
