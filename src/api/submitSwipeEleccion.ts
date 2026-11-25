import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Público — la elección de una persona en una ronda de «elegir entre las imágenes». Cada persona tiene UNA elección por
 * ronda: elegir otra imagen cambia la anterior (se borra su voto en las demás imágenes de la ronda y queda uno solo, de
 * valor 'potencial', en la elegida). Todo ocurre en una sola instrucción SQL, así que nunca queda a medias aunque varias
 * personas voten al mismo tiempo. Solo cuenta mientras la ronda esté abierta.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Registra (o cambia) la imagen que una persona elige en una ronda de «elegir entre las imágenes» de Swipe',
  inputSchema: z.object({
    participanteId: z.string(),
    capituloId: z.string(),
    ideaId: z.string(),
    msDecision: z.number().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    /** 'ronda_cerrada' = el facilitador ya la cerró; 'no_valida' = la imagen o la persona no son de esta ronda. */
    motivo: z.enum(['ronda_cerrada', 'no_valida']).optional(),
  }),
  execute: async ({ input }) => {
    const chequeo = await pool.query(
      `select c.estado, c.modo, (i.id is not null) as imagen_ok, (p.id is not null) as persona_ok
       from swipe_capitulos c
       left join swipe_ideas i on i.id = $2 and i.capitulo_id = c.id
       left join swipe_participantes p on p.id = $3 and p.sesion_id = c.sesion_id
       where c.id = $1`,
      [input.capituloId, input.ideaId, input.participanteId],
    );
    const fila = chequeo.rows[0];
    if (!fila || fila.modo !== 'duelo' || !fila.imagen_ok || !fila.persona_ok) return { ok: false, motivo: 'no_valida' as const };
    if (fila.estado !== 'abierto') return { ok: false, motivo: 'ronda_cerrada' as const };

    await pool.query(
      `with borrar as (
         delete from swipe_votos v using swipe_ideas i
         where v.idea_id = i.id and i.capitulo_id = $1 and v.participante_id = $2 and v.idea_id <> $3
       )
       insert into swipe_votos (idea_id, participante_id, valor, ms_decision)
       values ($3, $2, 'potencial', $4)
       on conflict (idea_id, participante_id)
       do update set valor = 'potencial', ms_decision = excluded.ms_decision, created_at = now()`,
      [input.capituloId, input.participanteId, input.ideaId, input.msDecision ?? null],
    );
    return { ok: true };
  },
});
