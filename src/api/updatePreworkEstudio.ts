import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Renombra o activa/desactiva un estudio de Prework',
  inputSchema: z.object({
    id: z.string(),
    nombre: z.string().min(1).optional(),
    activo: z.boolean().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.nombre !== undefined) { values.push(input.nombre.trim()); sets.push(`nombre = $${values.length}`); }
    if (input.activo !== undefined) { values.push(input.activo); sets.push(`activo = $${values.length}`); }
    if (sets.length === 0) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Nada que actualizar' });
    sets.push('updated_at = now()');

    values.push(input.id);
    const result = await pool.query(
      `update prework_estudios set ${sets.join(', ')} where id = $${values.length}`,
      values,
    );
    if (result.rowCount === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Estudio no encontrado' });

    return { success: true };
  },
});
