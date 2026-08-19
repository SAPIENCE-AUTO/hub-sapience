import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: false,
  description: 'Registra a un observador en la Sala de observación — requisito antes de ver el video, no un paso opcional',
  inputSchema: z.object({
    slug: z.string(),
    nombre: z.string().min(1),
    apellido: z.string().min(1),
    email: z.string().email(),
  }),
  outputSchema: z.object({ observerId: z.string() }),
  execute: async ({ input }) => {
    const sessionResult = await pool.query(`select id, estado from observation_sessions where slug = $1`, [input.slug]);
    const session = sessionResult.rows[0];
    if (!session || session.estado === 'borrador') throw new Error('Esta sesión no está disponible.');

    const inserted = await pool.query(
      `insert into observers (session_id, nombre, apellido, email) values ($1, $2, $3, $4) returning id`,
      [session.id, input.nombre, input.apellido, input.email],
    );
    return { observerId: inserted.rows[0].id };
  },
});
