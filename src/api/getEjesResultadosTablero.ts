import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaResultadoSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  imagenUrl: z.string().optional(),
  avgX: z.number(),
  avgY: z.number(),
  totalEvaluaciones: z.number(),
  cuadrante: z.enum(['alto_alto', 'bajo_alto', 'bajo_bajo', 'alto_bajo']).optional(),
  cuadranteLabel: z.string().optional(),
});

/**
 * Resultados agregados de UN tablero — el mapa de cuadrantes. Un punto por
 * idea (promedio de todas sus evaluaciones); las ideas sin evaluaciones
 * todavía no tienen posición (avgX/avgY sería NULL) y se excluyen del mapa,
 * pero sí se listan en `sinEvaluar` para que el facilitador sepa cuáles
 * faltan.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Resultados agregados (mapa de cuadrantes) de un tablero de Ejes para el dashboard del facilitador',
  inputSchema: z.object({ tableroId: z.string() }),
  outputSchema: z.object({
    ejeXLabel: z.string(),
    ejeXMin: z.number(),
    ejeXMax: z.number(),
    ejeYLabel: z.string(),
    ejeYMin: z.number(),
    ejeYMax: z.number(),
    cuadranteAltoAltoLabel: z.string().optional(),
    cuadranteBajoAltoLabel: z.string().optional(),
    cuadranteBajoBajoLabel: z.string().optional(),
    cuadranteAltoBajoLabel: z.string().optional(),
    totalParticipantesEvaluaron: z.number(),
    ideas: z.array(ideaResultadoSchema),
    sinEvaluar: z.array(z.object({ id: z.string(), titulo: z.string() })),
  }),
  execute: async ({ input }) => {
    const tabResult = await pool.query(
      `select eje_x_label, eje_x_min, eje_x_max, eje_y_label, eje_y_min, eje_y_max,
              cuadrante_alto_alto_label, cuadrante_bajo_alto_label, cuadrante_bajo_bajo_label, cuadrante_alto_bajo_label
       from ejes_tableros where id = $1`,
      [input.tableroId],
    );
    const tab = tabResult.rows[0];
    if (!tab) throw new Error('Tablero no encontrado');

    const ejeXMin = Number(tab.eje_x_min), ejeXMax = Number(tab.eje_x_max);
    const ejeYMin = Number(tab.eje_y_min), ejeYMax = Number(tab.eje_y_max);
    const midX = (ejeXMin + ejeXMax) / 2;
    const midY = (ejeYMin + ejeYMax) / 2;
    const cuadranteLabels = {
      alto_alto: tab.cuadrante_alto_alto_label as string | null,
      bajo_alto: tab.cuadrante_bajo_alto_label as string | null,
      bajo_bajo: tab.cuadrante_bajo_bajo_label as string | null,
      alto_bajo: tab.cuadrante_alto_bajo_label as string | null,
    };

    const ideasResult = await pool.query(
      `select i.id, i.titulo, i.imagen_url,
              avg(e.valor_x) as avg_x, avg(e.valor_y) as avg_y, count(e.id) as total_evaluaciones
       from ejes_ideas i
       left join ejes_evaluaciones e on e.idea_id = i.id
       where i.tablero_id = $1
       group by i.id
       order by i.orden asc`,
      [input.tableroId],
    );

    const participantesResult = await pool.query(
      `select count(distinct e.participante_id) as n
       from ejes_evaluaciones e
       join ejes_ideas i on i.id = e.idea_id
       where i.tablero_id = $1`,
      [input.tableroId],
    );

    const ideas: z.infer<typeof ideaResultadoSchema>[] = [];
    const sinEvaluar: { id: string; titulo: string }[] = [];

    for (const row of ideasResult.rows) {
      const totalEvaluaciones = Number(row.total_evaluaciones ?? 0);
      if (totalEvaluaciones === 0) {
        sinEvaluar.push({ id: row.id as string, titulo: row.titulo as string });
        continue;
      }
      const avgX = Number(row.avg_x);
      const avgY = Number(row.avg_y);
      const cuadrante = avgX >= midX
        ? (avgY >= midY ? 'alto_alto' as const : 'alto_bajo' as const)
        : (avgY >= midY ? 'bajo_alto' as const : 'bajo_bajo' as const);
      ideas.push({
        id: row.id as string,
        titulo: row.titulo as string,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        avgX, avgY, totalEvaluaciones,
        cuadrante,
        cuadranteLabel: cuadranteLabels[cuadrante] ?? undefined,
      });
    }

    return {
      ejeXLabel: tab.eje_x_label as string, ejeXMin, ejeXMax,
      ejeYLabel: tab.eje_y_label as string, ejeYMin, ejeYMax,
      cuadranteAltoAltoLabel: cuadranteLabels.alto_alto ?? undefined,
      cuadranteBajoAltoLabel: cuadranteLabels.bajo_alto ?? undefined,
      cuadranteBajoBajoLabel: cuadranteLabels.bajo_bajo ?? undefined,
      cuadranteAltoBajoLabel: cuadranteLabels.alto_bajo ?? undefined,
      totalParticipantesEvaluaron: Number(participantesResult.rows[0]?.n ?? 0),
      ideas,
      sinEvaluar,
    };
  },
});
