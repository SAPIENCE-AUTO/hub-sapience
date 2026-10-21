import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/** Tableros de Reclutamiento de un proyecto, para vincularles un formulario. */
export default createEndpoint({
  authenticated: true,
  description: 'Tableros de reclutamiento vivos de un proyecto',
  inputSchema: z.object({ proyectoId: z.string() }),
  outputSchema: z.object({ tableros: z.array(z.object({ id: z.string(), nombre: z.string() })) }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(
      `select b.id, b.board_name
       from boards b join projects p on p.project_code = b.project_code
       where p.id = $1 and b.board_type = 'recruitment' and b.deleted_at is null
       order by b.board_order nulls last, b.created_at`,
      [input.proyectoId],
    );
    return { tableros: rows.map((b) => ({ id: b.id, nombre: b.board_name ?? 'Sin nombre' })) };
  },
});
