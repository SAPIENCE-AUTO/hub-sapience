import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const ideaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Ideas + configuración de ejes de un tablero de Ejes para el participante — solo si está abierto',
  inputSchema: z.object({ tableroId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    nombre: z.string().optional(),
    descripcion: z.string().optional(),
    ejeXLabel: z.string().optional(),
    ejeXMin: z.number().optional(),
    ejeXMax: z.number().optional(),
    ejeYLabel: z.string().optional(),
    ejeYMin: z.number().optional(),
    ejeYMax: z.number().optional(),
    cuadranteAltoAltoLabel: z.string().optional(),
    cuadranteBajoAltoLabel: z.string().optional(),
    cuadranteBajoBajoLabel: z.string().optional(),
    cuadranteAltoBajoLabel: z.string().optional(),
    ideas: z.array(ideaSchema).optional(),
  }),
  execute: async ({ input }) => {
    const tabResult = await pool.query(
      `select nombre, descripcion, eje_x_label, eje_x_min, eje_x_max, eje_y_label, eje_y_min, eje_y_max,
              cuadrante_alto_alto_label, cuadrante_bajo_alto_label, cuadrante_bajo_bajo_label, cuadrante_alto_bajo_label
       from ejes_tableros where id = $1 and estado = 'abierto'`,
      [input.tableroId],
    );
    const tab = tabResult.rows[0];
    if (!tab) return { found: false };

    const ideasResult = await pool.query(
      `select id, titulo, descripcion, imagen_url, orden from ejes_ideas where tablero_id = $1 order by orden asc`,
      [input.tableroId],
    );

    return {
      found: true,
      nombre: tab.nombre as string,
      descripcion: (tab.descripcion ?? undefined) as string | undefined,
      ejeXLabel: tab.eje_x_label as string,
      ejeXMin: Number(tab.eje_x_min),
      ejeXMax: Number(tab.eje_x_max),
      ejeYLabel: tab.eje_y_label as string,
      ejeYMin: Number(tab.eje_y_min),
      ejeYMax: Number(tab.eje_y_max),
      cuadranteAltoAltoLabel: (tab.cuadrante_alto_alto_label ?? undefined) as string | undefined,
      cuadranteBajoAltoLabel: (tab.cuadrante_bajo_alto_label ?? undefined) as string | undefined,
      cuadranteBajoBajoLabel: (tab.cuadrante_bajo_bajo_label ?? undefined) as string | undefined,
      cuadranteAltoBajoLabel: (tab.cuadrante_alto_bajo_label ?? undefined) as string | undefined,
      ideas: ideasResult.rows.map((row) => ({
        id: row.id as string,
        titulo: row.titulo as string,
        descripcion: (row.descripcion ?? undefined) as string | undefined,
        imagenUrl: (row.imagen_url ?? undefined) as string | undefined,
        orden: Number(row.orden),
      })),
    };
  },
});
