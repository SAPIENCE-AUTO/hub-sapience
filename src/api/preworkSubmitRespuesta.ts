import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';
import { verifySessionToken } from '../../server/preworkAuth';
import { fechaHoyMexico } from '../../server/preworkDate';
import { publishEvent } from '../lib/ably';

const attachmentSchema = z.object({ url: z.string(), name: z.string().optional(), size: z.number().optional(), mimeType: z.string().optional() });

/**
 * Entrega de una misión. Sin unique en (mision_id, prework_participante_id)
 * a propósito (ver add-prework-tables.ts) — cada llamada inserta una fila
 * nueva, así que una misión tipo diario acepta varias entregas.
 */
export default createEndpoint({
  authenticated: false,
  description: 'El participante entrega una respuesta a una misión de Prework',
  inputSchema: z.object({
    token: z.string(),
    misionId: z.string(),
    contenido: z.record(z.string(), z.any()).optional(),
    archivos: z.array(attachmentSchema).optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input }) => {
    const session = verifySessionToken(input.token);
    if (!session) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión inválida o expirada.' });

    const { rows: misionRows } = await pool.query<{ id: string; prework_estudio_id: string }>(
      `select m.id, m.prework_estudio_id
       from prework_misiones m
       join prework_asignaciones a on a.prework_estudio_id = m.prework_estudio_id
       where m.id = $1 and a.prework_participante_id = $2 and a.incluido = true
         and m.estado = 'publicada'
         and (
           (m.modo_programacion = 'fecha_fija' and m.fecha_lanzamiento <= $3)
           or (m.modo_programacion = 'relativo_inicio' and a.fecha_inicio is not null
               and (a.fecha_inicio + ((m.dia_relativo - 1) * interval '1 day'))::date <= $3::date)
         )
       limit 1`,
      [input.misionId, session.participanteId, fechaHoyMexico()],
    );
    const mision = misionRows[0];
    if (!mision) throw new ZiteError({ code: 'NOT_FOUND', message: 'Misión no disponible para este participante.' });

    const { rows } = await pool.query<{ id: string }>(
      `insert into prework_respuestas (mision_id, prework_participante_id, prework_estudio_id, contenido, archivos, estado, entregada_at)
       values ($1, $2, $3, $4, $5, 'entregada', now())
       returning id`,
      [
        mision.id, session.participanteId, mision.prework_estudio_id,
        JSON.stringify(input.contenido ?? {}), JSON.stringify(input.archivos ?? []),
      ],
    );

    // No bloquea la respuesta al participante — mismo criterio que el voto
    // de Swipe (submitSwipeVotos.ts): la UI local ya avanzó, el realtime es
    // solo para que el panel del moderador se refresque solo.
    publishEvent(`prework:estudio:${mision.prework_estudio_id}`, 'respuesta.created', { misionId: mision.id }).catch(() => {});

    return { success: true, id: rows[0].id };
  },
});
