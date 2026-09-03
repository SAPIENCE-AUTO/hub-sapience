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

const capituloResultadoSchema = z.object({
  capituloId: z.string(),
  capituloNombre: z.string(),
  totalParticipantesVotaron: z.number(),
  ideas: z.array(ideaResultadoSchema),
});

/**
 * Igual que getSwipeResultados pero para TODOS los capítulos de la sesión
 * de una vez — para el "modo proyección" al cierre del workshop, donde no
 * tiene caso ir abriendo capítulo por capítulo. No se mezclan ideas de
 * distintos capítulos en un solo ranking (comparar ideas de temas
 * distintos no tiene sentido) — cada capítulo conserva su propio ranking,
 * solo que todos llegan en una sola respuesta.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Resultados agregados de todos los capítulos de una sesión de Swipe, para el modo proyección',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({ capitulos: z.array(capituloResultadoSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select
         c.id as capitulo_id, c.nombre as capitulo_nombre, c.orden as capitulo_orden,
         i.id, i.titulo, i.descripcion, i.imagen_url, i.orden as idea_orden,
         count(v.id) filter (where v.valor is not null) as total_votos,
         count(v.id) filter (where v.valor in ('potencial', 'super')) as potencial,
         count(v.id) filter (where v.valor = 'descarte') as descarte,
         count(v.id) filter (where v.valor = 'super') as super_likes,
         avg(v.ms_decision) filter (where v.ms_decision is not null) as avg_ms_decision
       from swipe_capitulos c
       join swipe_ideas i on i.capitulo_id = c.id
       left join swipe_votos v on v.idea_id = i.id
       where c.sesion_id = $1
       group by c.id, i.id
       order by c.orden asc, i.orden asc`,
      [input.sesionId],
    );

    const participantesResult = await pool.query(
      `select i.capitulo_id, count(distinct v.participante_id) as n
       from swipe_votos v
       join swipe_ideas i on i.id = v.idea_id
       join swipe_capitulos c on c.id = i.capitulo_id
       where c.sesion_id = $1
       group by i.capitulo_id`,
      [input.sesionId],
    );
    const participantesPorCapitulo = new Map<string, number>(
      participantesResult.rows.map((row) => [row.capitulo_id as string, Number(row.n)]),
    );

    const capitulos = new Map<string, { capituloId: string; capituloNombre: string; capituloOrden: number; ideas: any[] }>();
    for (const row of result.rows) {
      const capId = row.capitulo_id as string;
      if (!capitulos.has(capId)) {
        capitulos.set(capId, { capituloId: capId, capituloNombre: row.capitulo_nombre as string, capituloOrden: Number(row.capitulo_orden), ideas: [] });
      }
      const totalParticipantesVotaron = participantesPorCapitulo.get(capId) ?? 0;
      const potencial = Number(row.potencial ?? 0);
      const descarte = Number(row.descarte ?? 0);
      const superLikes = Number(row.super_likes ?? 0);
      const totalVotos = Number(row.total_votos ?? 0);
      const base = potencial + descarte;
      const pctPotencial = base > 0 ? Math.round((potencial / base) * 100) : 0;
      const score = pctPotencial + (totalParticipantesVotaron > 0 ? (superLikes / totalParticipantesVotaron) * 50 : 0);
      capitulos.get(capId)!.ideas.push({
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
      });
    }

    const ordenados = [...capitulos.values()].sort((a, b) => a.capituloOrden - b.capituloOrden);
    return {
      capitulos: ordenados.map((cap) => {
        // La mediana de tiempos es POR capítulo — cada uno tiene su propio
        // ritmo, no tiene sentido compararlo contra otro capítulo distinto.
        const medianaMs = medianaDe(cap.ideas.map((i) => i.avgMsDecision).filter((v): v is number => v !== undefined));
        return {
          capituloId: cap.capituloId,
          capituloNombre: cap.capituloNombre,
          totalParticipantesVotaron: participantesPorCapitulo.get(cap.capituloId) ?? 0,
          ideas: cap.ideas
            .map((idea) => ({ ...idea, quadrante: clasificarQuadrante(idea.pctPotencial, idea.avgMsDecision, medianaMs) }))
            .sort((a, b) => b.score - a.score),
        };
      }),
    };
  },
});
