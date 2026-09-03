import { z } from 'zod';
import { createEndpoint, ZiteError, Projects, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Crea un nuevo estudio de Prework dentro de un proyecto',
  inputSchema: z.object({ proyectoId: z.string(), nombre: z.string().min(1) }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const proyecto = await Projects.findOne({ id: input.proyectoId, fields: ['id'] });
    if (!proyecto) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });

    const { rows } = await pool.query<{ id: string }>(
      `insert into prework_estudios (proyecto_id, nombre, activo, created_by)
       values ($1, $2, true, $3)
       returning id`,
      [input.proyectoId, input.nombre.trim(), context.user!.id],
    );

    return { id: rows[0].id };
  },
});
