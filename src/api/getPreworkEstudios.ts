import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const estudioSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  activo: z.boolean(),
  totalParticipantes: z.number(),
  totalMisiones: z.number(),
  createdAt: z.string(),
});

/** Lista los "Prework" (estudios) de un proyecto — un proyecto puede tener varios, cada uno con sus propios participantes y misiones. */
export default createEndpoint({
  authenticated: true,
  description: 'Lista los estudios de Prework de un proyecto',
  inputSchema: z.object({ proyectoId: z.string() }),
  outputSchema: z.object({ estudios: z.array(estudioSchema) }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{
      id: string; nombre: string; activo: boolean; created_at: string;
      total_participantes: string; total_misiones: string;
    }>(
      `select e.id, e.nombre, e.activo, e.created_at,
              count(distinct a.id) as total_participantes,
              count(distinct m.id) as total_misiones
       from prework_estudios e
       left join prework_asignaciones a on a.prework_estudio_id = e.id and a.incluido = true
       left join prework_misiones m on m.prework_estudio_id = e.id
       where e.proyecto_id = $1
       group by e.id
       order by e.created_at asc`,
      [input.proyectoId],
    );

    return {
      estudios: rows.map(e => ({
        id: e.id,
        nombre: e.nombre,
        activo: e.activo,
        totalParticipantes: Number(e.total_participantes ?? 0),
        totalMisiones: Number(e.total_misiones ?? 0),
        createdAt: e.created_at,
      })),
    };
  },
});
