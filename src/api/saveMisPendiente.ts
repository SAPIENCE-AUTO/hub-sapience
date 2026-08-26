import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Crea o actualiza un pendiente personal (parking lot). Sin id = crear, nace fuente=manual.',
  inputSchema: z.object({
    id: z.string().optional(),
    titulo: z.string().optional(),
    notas: z.string().optional(),
    area: z.string().optional(),
    status: z.enum(['Pendiente', 'En curso', 'Resuelto']).optional(),
    fechaLimite: z.string().optional(),
    proyectoCode: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;

    if (input.id) {
      // Ownership check — nadie edita el pendiente de alguien más aunque adivine el id.
      const existing = await pool.query(`select id from pendientes_personales where id = $1 and user_id = $2`, [input.id, userId]);
      if (existing.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pendiente no encontrado' });

      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

      if (input.titulo !== undefined) push('titulo', input.titulo);
      if (input.notas !== undefined) push('notas', input.notas || null);
      if (input.area !== undefined) push('area', input.area || 'Sin clasificar');
      if (input.fechaLimite !== undefined) push('fecha_limite', input.fechaLimite || null);
      if (input.proyectoCode !== undefined) push('proyecto_code', input.proyectoCode || null);
      if (input.status !== undefined) {
        push('status', input.status);
        push('completed_at', input.status === 'Resuelto' ? new Date().toISOString() : null);
      }
      if (sets.length === 0) return { id: input.id };

      vals.push(input.id);
      await pool.query(`update pendientes_personales set ${sets.join(', ')} where id = $${vals.length}`, vals);
      return { id: input.id };
    }

    if (!input.titulo?.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Título requerido' });

    const { rows } = await pool.query(
      `insert into pendientes_personales (user_id, titulo, notas, area, status, fuente, fecha_limite, proyecto_code)
       values ($1, $2, $3, $4, 'Pendiente', 'manual', $5, $6)
       returning id`,
      [userId, input.titulo.trim(), input.notas || null, input.area || 'Sin clasificar', input.fechaLimite || null, input.proyectoCode || null],
    );
    return { id: rows[0].id };
  },
});
