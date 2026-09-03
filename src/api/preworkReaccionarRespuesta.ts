import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { verifySessionToken } from '../../server/preworkAuth';

/**
 * "like" (u otro tipo simple, sin comentario) es toggle: reaccionar dos
 * veces lo quita. Un comentario siempre se agrega como fila nueva, nunca
 * se toggle-a — puede haber varios comentarios del mismo participante.
 */
export default createEndpoint({
  authenticated: false,
  description: 'El participante reacciona (like/comentario) a una respuesta del feed social de Prework',
  inputSchema: z.object({
    token: z.string(),
    respuestaId: z.string(),
    tipo: z.string().default('like'),
    comentario: z.string().optional(),
  }),
  outputSchema: z.object({ reacted: z.boolean() }),
  execute: async ({ input }) => {
    const session = verifySessionToken(input.token);
    if (!session) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión inválida o expirada.' });

    const { rows: respuestaRows } = await pool.query<{ mision_id: string; prework_estudio_id: string }>(
      `select r.mision_id, r.prework_estudio_id
       from prework_respuestas r
       join prework_misiones m on m.id = r.mision_id
       join prework_asignaciones a on a.prework_estudio_id = r.prework_estudio_id
       where r.id = $1 and m.visibilidad = 'social' and a.prework_participante_id = $2 and a.incluido = true
       limit 1`,
      [input.respuestaId, session.participanteId],
    );
    if (!respuestaRows[0]) throw new ZiteError({ code: 'FORBIDDEN', message: 'No puedes reaccionar a esta respuesta.' });

    if (input.comentario?.trim()) {
      await pool.query(
        `insert into prework_reacciones (respuesta_id, prework_participante_id, tipo, comentario)
         values ($1, $2, 'comentario', $3)`,
        [input.respuestaId, session.participanteId, input.comentario.trim()],
      );
      return { reacted: true };
    }

    const { rows: existing } = await pool.query(
      `select id from prework_reacciones where respuesta_id = $1 and prework_participante_id = $2 and tipo = $3`,
      [input.respuestaId, session.participanteId, input.tipo],
    );
    if (existing[0]) {
      await pool.query(`delete from prework_reacciones where id = $1`, [existing[0].id]);
      return { reacted: false };
    }

    await pool.query(
      `insert into prework_reacciones (respuesta_id, prework_participante_id, tipo) values ($1, $2, $3)`,
      [input.respuestaId, session.participanteId, input.tipo],
    );
    return { reacted: true };
  },
});
