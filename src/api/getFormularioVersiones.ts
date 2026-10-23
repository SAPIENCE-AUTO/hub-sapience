import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/** Versiones guardadas de un screener, de la más nueva a la más vieja (sin la definición: se pide al abrir una). */
export default createEndpoint({
  authenticated: true,
  description: 'Lista las versiones guardadas del screener de un formulario',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({
    versiones: z.array(z.object({
      id: z.string(),
      revision: z.number(),
      /** Sin nota = automática: cómo estaba antes de una tanda de cambios. */
      nota: z.string().optional(),
      autor: z.string().optional(),
      createdAt: z.string(),
    })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(
      `select v.id, v.revision, v.nota, v.created_at, trim(concat_ws(' ', u.first_name, u.last_name)) as autor
       from formulario_versiones v left join users u on u.id = v.created_by
       where v.formulario_id = $1 order by v.created_at desc limit 50`,
      [input.formularioId],
    );
    return {
      versiones: rows.map((r) => ({
        id: r.id, revision: r.revision, nota: r.nota ?? undefined, autor: r.autor || undefined,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  },
});
