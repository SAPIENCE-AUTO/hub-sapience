import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const sesionSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  cliente: z.string().optional(),
  estado: z.string(),
  tablerosCount: z.number(),
  createdAt: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Lista las sesiones de Ejes para el dashboard del facilitador, opcionalmente filtradas por proyecto',
  inputSchema: z.object({ proyectoId: z.string().optional() }),
  outputSchema: z.object({ sesiones: z.array(sesionSchema) }),
  execute: async ({ input }) => {
    const result = await pool.query(
      `select s.id, s.codigo, s.nombre, s.cliente, s.estado, s.created_at, count(t.id) as tableros_count
       from ejes_sesiones s
       left join ejes_tableros t on t.sesion_id = s.id
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
        tablerosCount: Number(row.tableros_count ?? 0),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  },
});
