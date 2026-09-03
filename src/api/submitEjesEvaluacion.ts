import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { publishEvent } from '../lib/ably';

/**
 * Público — registra (o actualiza) la evaluación de un participante sobre
 * una idea. Idempotente vía `on conflict (idea_id, participante_id)`, igual
 * que Swipe. A diferencia de Swipe, aquí SÍ se empuja un evento en tiempo
 * real (`ejes:tablero:{tableroId}`) — es el requisito explícito de este
 * tool ("en tiempo real se vaya armando el mapa"), fire-and-forget para no
 * bloquear la respuesta al participante.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Registra la evaluación de un participante sobre una idea de Ejes (posición en los 2 ejes)',
  inputSchema: z.object({
    participanteId: z.string(),
    ideaId: z.string(),
    valorX: z.number(),
    valorY: z.number(),
    msDecision: z.number().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const ideaResult = await pool.query(`select tablero_id from ejes_ideas where id = $1`, [input.ideaId]);
    const idea = ideaResult.rows[0];
    if (!idea) throw new Error('Idea no encontrada');

    await pool.query(
      `insert into ejes_evaluaciones (idea_id, participante_id, valor_x, valor_y, ms_decision)
       values ($1, $2, $3, $4, $5)
       on conflict (idea_id, participante_id) do update
         set valor_x = excluded.valor_x, valor_y = excluded.valor_y, ms_decision = excluded.ms_decision`,
      [input.ideaId, input.participanteId, input.valorX, input.valorY, input.msDecision ?? null],
    );

    publishEvent(`ejes:tablero:${idea.tablero_id}`, 'evaluacion.created', { ideaId: input.ideaId }).catch(() => {});

    return { ok: true };
  },
});
