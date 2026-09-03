import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const misionSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  tipo: z.string(),
  configuracion: z.any(),
  visibilidad: z.string(),
  modoProgramacion: z.string(),
  fechaLanzamiento: z.string().optional(),
  diaRelativo: z.number().optional(),
  orden: z.number(),
  estado: z.string(),
  totalRespuestas: z.number(),
  createdAt: z.string(),
});

/** Board del moderador: todas las misiones de un estudio (cualquier estado), con conteo de entregas. */
export default createEndpoint({
  authenticated: true,
  description: 'Lista las misiones de un estudio de Prework, para el moderador',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: z.object({ misiones: z.array(misionSchema) }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{
      id: string; titulo: string; descripcion: string | null; tipo: string; configuracion: unknown;
      visibilidad: string; modo_programacion: string; fecha_lanzamiento: string | null; dia_relativo: number | null;
      orden: number; estado: string; total_respuestas: string; created_at: string;
    }>(
      `select m.id, m.titulo, m.descripcion, m.tipo, m.configuracion, m.visibilidad,
              m.modo_programacion, m.fecha_lanzamiento, m.dia_relativo, m.orden, m.estado, m.created_at,
              count(r.id) as total_respuestas
       from prework_misiones m
       left join prework_respuestas r on r.mision_id = m.id
       where m.prework_estudio_id = $1
       group by m.id
       order by m.modo_programacion, m.fecha_lanzamiento asc nulls last, m.dia_relativo asc nulls last, m.orden asc`,
      [input.estudioId],
    );

    return {
      misiones: rows.map(m => ({
        id: m.id,
        titulo: m.titulo,
        descripcion: m.descripcion ?? undefined,
        tipo: m.tipo,
        configuracion: m.configuracion,
        visibilidad: m.visibilidad,
        modoProgramacion: m.modo_programacion,
        fechaLanzamiento: m.fecha_lanzamiento ?? undefined,
        diaRelativo: m.dia_relativo ?? undefined,
        orden: m.orden,
        estado: m.estado,
        totalRespuestas: Number(m.total_respuestas ?? 0),
        createdAt: m.created_at,
      })),
    };
  },
});
