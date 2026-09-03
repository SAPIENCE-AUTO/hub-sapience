import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'El moderador envía un follow-up a un participante de Prework',
  inputSchema: z.object({
    estudioId: z.string(),
    participanteId: z.string(),
    misionId: z.string().optional(),
    mensaje: z.string().min(1),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into prework_seguimientos (prework_estudio_id, prework_participante_id, mision_id, mensaje, creado_por)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [input.estudioId, input.participanteId, input.misionId ?? null, input.mensaje, context.user!.id],
    );
    publishEvent(`prework:participante:${input.participanteId}`, 'seguimiento.created', { id: rows[0].id }).catch(() => {});

    return { id: rows[0].id };
  },
});
