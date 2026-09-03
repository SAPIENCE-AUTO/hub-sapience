import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Crea un tablero (con su configuración de 2 ejes) dentro de una sesión de Ejes',
  inputSchema: z.object({
    sesionId: z.string(),
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    ejeXLabel: z.string().min(1),
    ejeXMin: z.number().default(0),
    ejeXMax: z.number().default(100),
    ejeYLabel: z.string().min(1),
    ejeYMin: z.number().default(0),
    ejeYMax: z.number().default(100),
    cuadranteAltoAltoLabel: z.string().optional(),
    cuadranteBajoAltoLabel: z.string().optional(),
    cuadranteBajoBajoLabel: z.string().optional(),
    cuadranteAltoBajoLabel: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input }) => {
    const ordenResult = await pool.query(
      `select coalesce(max(orden), -1) + 1 as siguiente from ejes_tableros where sesion_id = $1`,
      [input.sesionId],
    );
    const orden = ordenResult.rows[0].siguiente as number;

    const result = await pool.query(
      `insert into ejes_tableros (
         sesion_id, nombre, descripcion, orden,
         eje_x_label, eje_x_min, eje_x_max, eje_y_label, eje_y_min, eje_y_max,
         cuadrante_alto_alto_label, cuadrante_bajo_alto_label, cuadrante_bajo_bajo_label, cuadrante_alto_bajo_label
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning id`,
      [
        input.sesionId, input.nombre, input.descripcion ?? null, orden,
        input.ejeXLabel, input.ejeXMin, input.ejeXMax, input.ejeYLabel, input.ejeYMin, input.ejeYMax,
        input.cuadranteAltoAltoLabel ?? null, input.cuadranteBajoAltoLabel ?? null,
        input.cuadranteBajoBajoLabel ?? null, input.cuadranteAltoBajoLabel ?? null,
      ],
    );
    return { id: result.rows[0].id as string };
  },
});
