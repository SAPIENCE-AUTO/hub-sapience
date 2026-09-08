import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { setEmailFlagStatus } from '../serverUtils/graphMailSync';

export default createEndpoint({
  authenticated: true,
  description: 'Crea o actualiza un pendiente personal (parking lot). Sin id = crear, nace fuente=manual.',
  inputSchema: z.object({
    id: z.string().optional(),
    titulo: z.string().optional(),
    status: z.enum(['Pendiente', 'En curso', 'Resuelto']).optional(),
    fechaLimite: z.string().optional(),
    proyectoCode: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;

    if (input.id) {
      // Ownership check — nadie edita el pendiente de alguien más aunque adivine el id.
      const existing = await pool.query(`select id, fuente, correo_message_id from pendientes_personales where id = $1 and user_id = $2`, [input.id, userId]);
      if (existing.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pendiente no encontrado' });

      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

      if (input.titulo !== undefined) push('titulo', input.titulo);
      if (input.fechaLimite !== undefined) push('fecha_limite', input.fechaLimite || null);
      if (input.proyectoCode !== undefined) push('proyecto_code', input.proyectoCode || null);
      if (input.status !== undefined) {
        push('status', input.status);
        push('completed_at', input.status === 'Resuelto' ? new Date().toISOString() : null);
      }
      if (sets.length === 0) return { id: input.id };

      vals.push(input.id);
      await pool.query(`update pendientes_personales set ${sets.join(', ')} where id = $${vals.length}`, vals);

      // Refleja el estado en el correo real de Outlook — best-effort, nunca
      // debe tumbar el guardado (Graph puede fallar, o el policy de Exchange
      // aún no estar propagado para este usuario).
      const row = existing.rows[0];
      if (input.status !== undefined && row.fuente === 'correo' && row.correo_message_id) {
        try {
          await setEmailFlagStatus(context.user!.email, row.correo_message_id, input.status === 'Resuelto' ? 'complete' : 'flagged');
        } catch (err) {
          console.log('[saveMisPendiente] no se pudo actualizar el flag en Outlook:', err);
        }
      }

      return { id: input.id };
    }

    if (!input.titulo?.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Título requerido' });

    // row_order: al final de todo (contador global, no por área) — como cada
    // área siempre ordena su propio subconjunto por row_order, un valor
    // global creciente ya deja el pendiente nuevo al final de cualquier área
    // en la que termine, sin necesitar saber el área todavía en este punto
    // (se asigna aparte, vía CellValues, igual que ya hace quickCreate).
    const { rows } = await pool.query(
      `insert into pendientes_personales (user_id, titulo, status, fuente, fecha_limite, proyecto_code, row_order)
       values ($1, $2, 'Pendiente', 'manual', $3, $4,
               (select coalesce(max(row_order), 0) + 1000 from pendientes_personales where user_id = $1))
       returning id`,
      [userId, input.titulo.trim(), input.fechaLimite || null, input.proyectoCode || null],
    );
    return { id: rows[0].id };
  },
});
