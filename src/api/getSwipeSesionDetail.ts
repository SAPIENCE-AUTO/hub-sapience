import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const capituloSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  orden: z.number(),
  estado: z.string(),
  ideasCount: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Detalle de una sesión de Swipe para el dashboard: datos de la sesión y sus capítulos',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string().optional(),
    codigo: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    estado: z.string().optional(),
    capitulos: z.array(capituloSchema).optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, codigo, nombre, cliente, estado from swipe_sesiones where id = $1`,
      [input.sesionId],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    const capitulosResult = await pool.query(
      `select c.id, c.nombre, c.descripcion, c.orden, c.estado, count(i.id) as ideas_count
       from swipe_capitulos c
       left join swipe_ideas i on i.capitulo_id = c.id
       where c.sesion_id = $1
       group by c.id
       order by c.orden asc`,
      [input.sesionId],
    );

    return {
      found: true,
      id: sesion.id as string,
      codigo: sesion.codigo as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      estado: sesion.estado as string,
      capitulos: capitulosResult.rows.map((row) => ({
        id: row.id as string,
        nombre: row.nombre as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        orden: Number(row.orden),
        estado: row.estado as string,
        ideasCount: Number(row.ideas_count ?? 0),
      })),
    };
  },
});
