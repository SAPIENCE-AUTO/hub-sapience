import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

/**
 * Todas las respuestas completas de un formulario, para el Excel del panel
 * (el panel arma la hoja con lib/formularios/tabla.ts). Las fotos no van:
 * solo cuántas subió cada persona — se ven en el Hub, que es privado.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Respuestas completas de un formulario para descargarlas en Excel',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    titulo: z.string().optional(),
    definicion: z.any().optional(),
    filas: z.array(z.object({
      createdAt: z.string(),
      esPrueba: z.boolean(),
      respuestas: z.any(),
      resultado: z.any(),
      duracionSeg: z.number().optional(),
    })).optional(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select titulo, definicion from formularios where id = $1`, [input.formularioId]);
    if (!f) return { found: false };
    const { rows } = await pool.query(
      `select created_at, es_prueba, respuestas, resultado, duracion_seg
       from formulario_respuestas where formulario_id = $1 order by created_at`,
      [input.formularioId],
    );
    return {
      found: true, titulo: f.titulo, definicion: f.definicion,
      filas: rows.map((r) => ({
        createdAt: new Date(r.created_at).toISOString(),
        esPrueba: r.es_prueba,
        respuestas: r.respuestas,
        resultado: r.resultado,
        duracionSeg: r.duracion_seg ?? undefined,
      })),
    };
  },
});
