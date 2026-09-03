import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const seguimientoSchema = z.object({
  id: z.string(),
  misionId: z.string().optional(),
  misionTitulo: z.string().optional(),
  mensaje: z.string(),
  leido: z.boolean(),
  respuestaParticipante: z.string().optional(),
  createdAt: z.string(),
});

/** Historial de follow-ups del moderador a un participante, para revisarlo junto con sus respuestas. */
export default createEndpoint({
  authenticated: true,
  description: 'Lista los follow-ups enviados a un participante dentro de un estudio de Prework',
  inputSchema: z.object({ estudioId: z.string(), participanteId: z.string() }),
  outputSchema: z.object({ seguimientos: z.array(seguimientoSchema) }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{
      id: string; mision_id: string | null; mision_titulo: string | null; mensaje: string;
      leido: boolean; respuesta_participante: string | null; created_at: string;
    }>(
      `select s.id, s.mision_id, m.titulo as mision_titulo, s.mensaje, s.leido, s.respuesta_participante, s.created_at
       from prework_seguimientos s
       left join prework_misiones m on m.id = s.mision_id
       where s.prework_estudio_id = $1 and s.prework_participante_id = $2
       order by s.created_at desc`,
      [input.estudioId, input.participanteId],
    );

    return {
      seguimientos: rows.map(s => ({
        id: s.id,
        misionId: s.mision_id ?? undefined,
        misionTitulo: s.mision_titulo ?? undefined,
        mensaje: s.mensaje,
        leido: s.leido,
        respuestaParticipante: s.respuesta_participante ?? undefined,
        createdAt: s.created_at,
      })),
    };
  },
});
