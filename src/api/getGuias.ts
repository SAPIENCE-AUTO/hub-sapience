import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { puedeBorrar } from '../serverUtils/guias/datos';

// Lista de guías (de un proyecto si se pasa projectId), de la más reciente a la más vieja.
export default createEndpoint({
  authenticated: true,
  description: 'Guías de tópicos guardadas (opcionalmente de un proyecto)',
  inputSchema: z.object({ projectId: z.string().optional() }),
  outputSchema: z.object({
    guias: z.array(z.object({
      id: z.string(), titulo: z.string(), tipo: z.string(), duracion: z.number(), bloques: z.number(), escritos: z.number(),
      autor: z.string().optional(), updatedAt: z.string(), puedeBorrar: z.boolean(),
    })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const { rows } = await pool.query(
      `select g.id::text, g.titulo, g.estado, g.updated_at, g.created_by_id::text as autor_id,
              nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '') as autor
         from guias_topicos g left join users u on u.id = g.created_by_id
        where g.deleted_at is null and ($1::uuid is null or g.project_id = $1::uuid)
        order by g.updated_at desc limit 200`,
      [input.projectId ?? null],
    );
    return {
      guias: rows.map((r: any) => ({
        id: r.id, titulo: r.titulo ?? '', tipo: r.estado?.tipo ?? '', duracion: r.estado?.duracion ?? 0,
        bloques: r.estado?.roadmap?.bloques?.length ?? 0, escritos: (r.estado?.guia ?? []).filter(Boolean).length,
        autor: r.autor ?? undefined, updatedAt: new Date(r.updated_at).toISOString(),
        puedeBorrar: puedeBorrar(context, { createdBy: r.autor_id }),
      })),
    };
  },
});
