import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const votoSchema = z.object({
  capituloId: z.string(),
  capituloNombre: z.string(),
  ideaId: z.string(),
  ideaTitulo: z.string(),
  alias: z.string(),
  valor: z.string(),
  msDecision: z.number().optional(),
  createdAt: z.string(),
});

/**
 * Todos los votos de una sesión de Swipe, uno por renglón (quién votó, en qué idea, qué y cuánto tardó) — para exportar los resultados a Excel junto
 * con el resumen por idea de getSwipeResultadosSesion. Es lo mismo que el facilitador ya ve idea por idea con getSwipeVotosDeIdea, pero de toda la sesión
 * de una vez. En el orden de la sesión: capítulos, ideas y, dentro de cada idea, el orden en que se votó.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Todos los votos de una sesión de Swipe (quién votó qué en cada idea y cuánto tardó), para exportar a Excel',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({ votos: z.array(votoSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select c.id as capitulo_id, c.nombre as capitulo_nombre, i.id as idea_id, i.titulo as idea_titulo,
              p.alias, v.valor, v.ms_decision, v.created_at
         from swipe_votos v
         join swipe_ideas i on i.id = v.idea_id
         join swipe_capitulos c on c.id = i.capitulo_id
         join swipe_participantes p on p.id = v.participante_id
        where c.sesion_id = $1
        order by c.orden asc, i.orden asc, v.created_at asc`,
      [input.sesionId],
    );
    return {
      votos: result.rows.map((row) => ({
        capituloId: row.capitulo_id as string,
        capituloNombre: row.capitulo_nombre as string,
        ideaId: row.idea_id as string,
        ideaTitulo: row.idea_titulo as string,
        alias: row.alias as string,
        valor: row.valor as string,
        msDecision: (row.ms_decision ?? undefined) as number | undefined,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  },
});
