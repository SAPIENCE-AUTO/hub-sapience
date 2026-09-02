import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Público — recibe un batch de votos (el spec exige que sea batch para
 * soportar buffer offline más adelante) e inserta uno por uno en la misma
 * conexión. Idempotente vía `on conflict (idea_id, participante_id)`: un
 * reintento con el mismo voto nunca duplica ni truena.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Registra (o actualiza) uno o más votos de un participante de Swipe',
  inputSchema: z.object({
    participanteId: z.string(),
    votos: z.array(z.object({
      ideaId: z.string(),
      valor: z.enum(['potencial', 'descarte', 'super']),
      msDecision: z.number().optional(),
    })).min(1),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    for (const voto of input.votos) {
      await pool.query(
        `insert into swipe_votos (idea_id, participante_id, valor, ms_decision)
         values ($1, $2, $3, $4)
         on conflict (idea_id, participante_id) do update set valor = excluded.valor, ms_decision = excluded.ms_decision`,
        [voto.ideaId, input.participanteId, voto.valor, voto.msDecision ?? null],
      );
    }
    return { ok: true };
  },
});
