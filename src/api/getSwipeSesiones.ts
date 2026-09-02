import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const sesionSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  cliente: z.string().optional(),
  estado: z.string(),
  capitulosCount: z.number(),
  createdAt: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Lista las sesiones de Swipe para el dashboard del facilitador, opcionalmente filtradas por proyecto',
  inputSchema: z.object({ proyectoId: z.string().optional() }),
  outputSchema: z.object({ sesiones: z.array(sesionSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select s.id, s.codigo, s.nombre, s.cliente, s.estado, s.created_at, count(c.id) as capitulos_count
       from swipe_sesiones s
       left join swipe_capitulos c on c.sesion_id = s.id
       where $1::uuid is null or s.proyecto_id = $1
       group by s.id
       order by s.created_at desc`,
      [input.proyectoId ?? null],
    );
    return {
      sesiones: result.rows.map((row) => ({
        id: row.id as string,
        codigo: row.codigo as string,
        nombre: row.nombre as string,
        cliente: (row.cliente ?? undefined) as string | undefined,
        estado: row.estado as string,
        capitulosCount: Number(row.capitulos_count ?? 0),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  },
});
