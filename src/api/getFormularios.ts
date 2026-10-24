import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Lista los formularios (screeners) de un proyecto, con cuántas respuestas tiene cada uno',
  inputSchema: z.object({ proyectoId: z.string().optional() }),
  outputSchema: z.object({
    formularios: z.array(z.object({
      id: z.string(),
      codigo: z.string(),
      titulo: z.string(),
      estado: z.string(),
      createdAt: z.string(),
      respuestasPrueba: z.number(),
      respuestasReales: z.number(),
      califican: z.number(),
      /** Para decir en qué paso va: la etapa del generador (si salió de la IA), la cuota total y lo real. */
      etapa: z.string().optional(),
      meta: z.number(),
      calificanReales: z.number(),
      cambiosPendientes: z.boolean(),
      /** Código del proyecto (para elegir un filtro anterior de otro proyecto). */
      proyecto: z.string().optional(),
    })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows } = await pool.query(
      `select f.id, f.codigo, f.titulo, f.estado, f.created_at, max(p.project_code) as proyecto,
              f.generador->>'etapa' as etapa, f.cambios is not null as cambios_pendientes,
              (select coalesce(sum((fr->>'meta')::int), 0) from jsonb_array_elements(coalesce(f.definicion->'frentes', '[]'::jsonb)) fr)::int as meta,
              count(r.id) filter (where r.es_prueba)::int as prueba,
              count(r.id) filter (where not r.es_prueba)::int as reales,
              count(r.id) filter (where r.califica)::int as califican,
              count(r.id) filter (where r.califica and not r.es_prueba)::int as califican_reales
       from formularios f
       left join formulario_respuestas r on r.formulario_id = f.id
       left join projects p on p.id = f.proyecto_id
       where ($1::uuid is null or f.proyecto_id = $1::uuid)
       group by f.id
       order by f.created_at desc`,
      [input.proyectoId ?? null],
    );
    return {
      formularios: rows.map((f) => ({
        id: f.id, codigo: f.codigo, titulo: f.titulo, estado: f.estado,
        createdAt: new Date(f.created_at).toISOString(),
        respuestasPrueba: f.prueba, respuestasReales: f.reales, califican: f.califican, proyecto: f.proyecto ?? undefined,
        etapa: f.etapa ?? undefined, meta: f.meta, calificanReales: f.califican_reales, cambiosPendientes: !!f.cambios_pendientes,
      })),
    };
  },
});
