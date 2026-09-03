import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const tableroSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  orden: z.number(),
  estado: z.string(),
  ejeXLabel: z.string(),
  ejeYLabel: z.string(),
  ideasCount: z.number(),
  ideaThumbnails: z.array(z.string()),
  evaluacionesCount: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Detalle de una sesión de Ejes para el dashboard: datos de la sesión y sus tableros',
  inputSchema: z.object({ sesionId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string().optional(),
    codigo: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    estado: z.string().optional(),
    participantesCount: z.number().optional(),
    tableros: z.array(tableroSchema).optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, codigo, nombre, cliente, estado from ejes_sesiones where id = $1`,
      [input.sesionId],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    const tablerosResult = await pool.query(
      `select t.id, t.nombre, t.descripcion, t.orden, t.estado, t.eje_x_label, t.eje_y_label,
              count(distinct i.id) as ideas_count,
              count(distinct e.id) as evaluaciones_count
       from ejes_tableros t
       left join ejes_ideas i on i.tablero_id = t.id
       left join ejes_evaluaciones e on e.idea_id = i.id
       where t.sesion_id = $1
       group by t.id
       order by t.orden asc`,
      [input.sesionId],
    );

    const thumbsResult = await pool.query(
      `select i.tablero_id, i.imagen_url
       from ejes_ideas i
       join ejes_tableros t on t.id = i.tablero_id
       where t.sesion_id = $1 and i.imagen_url is not null
       order by i.tablero_id, i.orden asc`,
      [input.sesionId],
    );
    const thumbsPorTablero = new Map<string, string[]>();
    for (const row of thumbsResult.rows) {
      const lista = thumbsPorTablero.get(row.tablero_id) ?? [];
      if (lista.length < 3) lista.push(row.imagen_url);
      thumbsPorTablero.set(row.tablero_id, lista);
    }

    const participantesResult = await pool.query(
      `select count(*) as n from ejes_participantes where sesion_id = $1`,
      [input.sesionId],
    );

    return {
      found: true,
      id: sesion.id as string,
      codigo: sesion.codigo as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      estado: sesion.estado as string,
      participantesCount: Number(participantesResult.rows[0]?.n ?? 0),
      tableros: tablerosResult.rows.map((row) => ({
        id: row.id as string,
        nombre: row.nombre as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        orden: Number(row.orden),
        estado: row.estado as string,
        ejeXLabel: row.eje_x_label as string,
        ejeYLabel: row.eje_y_label as string,
        ideasCount: Number(row.ideas_count ?? 0),
        ideaThumbnails: thumbsPorTablero.get(row.id) ?? [],
        evaluacionesCount: Number(row.evaluaciones_count ?? 0),
      })),
    };
  },
});
