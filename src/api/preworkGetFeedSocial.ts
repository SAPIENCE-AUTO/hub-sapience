import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { verifySessionToken } from '../../server/preworkAuth';
import { fechaHoyMexico } from '../../server/preworkDate';

const comentarioSchema = z.object({ alias: z.string(), comentario: z.string(), createdAt: z.string() });
const entradaSchema = z.object({
  id: z.string(),
  alias: z.string(),
  esMia: z.boolean(),
  contenido: z.any(),
  archivos: z.any(),
  entregadaAt: z.string(),
  likes: z.number(),
  meGusta: z.boolean(),
  comentarios: z.array(comentarioSchema),
});

/**
 * Feed de otras respuestas a una misión "social" — solo visible una vez que
 * el propio participante ya entregó la suya (evita el sesgo de anclaje de
 * ver respuestas ajenas antes de responder; mismo criterio de revelar
 * resultados después de votar que ya usa Swipe). El alias es solo el primer
 * nombre — nunca el correo ni el nombre completo, mismo espíritu de
 * privacidad que el alias de Swipe (ahí es literal porque no hay cuenta
 * real; acá sí la hay, así que se recorta en vez de inventar uno nuevo).
 */
export default createEndpoint({
  authenticated: false,
  description: 'Feed social de respuestas a una misión de Prework con visibilidad social',
  inputSchema: z.object({ token: z.string(), misionId: z.string() }),
  outputSchema: z.object({ entradas: z.array(entradaSchema) }),
  execute: async ({ input }) => {
    const session = verifySessionToken(input.token);
    if (!session) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión inválida o expirada.' });

    const { rows: misionRows } = await pool.query<{ id: string }>(
      `select m.id
       from prework_misiones m
       join prework_asignaciones a on a.prework_estudio_id = m.prework_estudio_id
       where m.id = $1 and a.prework_participante_id = $2 and a.incluido = true
         and m.visibilidad = 'social' and m.estado = 'publicada'
         and (
           (m.modo_programacion = 'fecha_fija' and m.fecha_lanzamiento <= $3)
           or (m.modo_programacion = 'relativo_inicio' and a.fecha_inicio is not null
               and (a.fecha_inicio + ((m.dia_relativo - 1) * interval '1 day'))::date <= $3::date)
         )
       limit 1`,
      [input.misionId, session.participanteId, fechaHoyMexico()],
    );
    if (!misionRows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Esta misión no tiene feed social disponible.' });

    const { rows: yaEntregue } = await pool.query(
      `select 1 from prework_respuestas where mision_id = $1 and prework_participante_id = $2 limit 1`,
      [input.misionId, session.participanteId],
    );
    if (!yaEntregue[0]) throw new ZiteError({ code: 'FORBIDDEN', message: 'Entrega tu respuesta primero para ver las de los demás.' });

    const { rows } = await pool.query<{
      id: string; nombre: string; participante_id: string; contenido: unknown; archivos: unknown; entregada_at: string;
    }>(
      `select r.id, p.nombre, r.prework_participante_id as participante_id, r.contenido, r.archivos, r.entregada_at
       from prework_respuestas r
       join prework_participantes p on p.id = r.prework_participante_id
       where r.mision_id = $1
       order by r.entregada_at asc`,
      [input.misionId],
    );
    if (rows.length === 0) return { entradas: [] };

    const { rows: reacciones } = await pool.query<{
      respuesta_id: string; tipo: string; comentario: string | null; participante_id: string; nombre: string; created_at: string;
    }>(
      `select rr.respuesta_id, rr.tipo, rr.comentario, rr.prework_participante_id as participante_id, p.nombre, rr.created_at
       from prework_reacciones rr
       join prework_participantes p on p.id = rr.prework_participante_id
       where rr.respuesta_id = any($1::uuid[])`,
      [rows.map(r => r.id)],
    );

    return {
      entradas: rows.map(r => {
        const propias = reacciones.filter(x => x.respuesta_id === r.id);
        const likes = propias.filter(x => x.tipo === 'like');
        return {
          id: r.id,
          alias: r.nombre.split(' ')[0],
          esMia: r.participante_id === session.participanteId,
          contenido: r.contenido,
          archivos: r.archivos,
          entregadaAt: r.entregada_at,
          likes: likes.length,
          meGusta: likes.some(l => l.participante_id === session.participanteId),
          comentarios: propias
            .filter(x => x.tipo === 'comentario' && x.comentario)
            .map(x => ({ alias: x.nombre.split(' ')[0], comentario: x.comentario as string, createdAt: x.created_at })),
        };
      }),
    };
  },
});
