import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const tagSchema = z.object({ id: z.string(), nombre: z.string(), color: z.string().optional() });

const respuestaSchema = z.object({
  id: z.string(),
  misionId: z.string(),
  misionTitulo: z.string(),
  misionTipo: z.string(),
  participanteId: z.string(),
  participanteNombre: z.string(),
  participanteEmail: z.string(),
  contenido: z.any(),
  archivos: z.any(),
  estado: z.string(),
  transcripcion: z.string().optional(),
  transcripcionGeneradaAt: z.string().optional(),
  analisisAi: z.any().optional(),
  entregadaAt: z.string().optional(),
  tags: z.array(tagSchema),
});

/** Panel de respuestas del moderador, con filtros opcionales. */
export default createEndpoint({
  authenticated: true,
  description: 'Lista respuestas de un estudio de Prework, con filtros de misión/participante/estado/tag',
  inputSchema: z.object({
    estudioId: z.string(),
    misionId: z.string().optional(),
    participanteId: z.string().optional(),
    estado: z.enum(['pendiente', 'entregada', 'revisada']).optional(),
    tagId: z.string().optional(),
  }),
  outputSchema: z.object({ respuestas: z.array(respuestaSchema) }),
  execute: async ({ input }) => {
    const conditions = ['r.prework_estudio_id = $1'];
    const values: unknown[] = [input.estudioId];
    if (input.misionId) { values.push(input.misionId); conditions.push(`r.mision_id = $${values.length}`); }
    if (input.participanteId) { values.push(input.participanteId); conditions.push(`r.prework_participante_id = $${values.length}`); }
    if (input.estado) { values.push(input.estado); conditions.push(`r.estado = $${values.length}`); }
    if (input.tagId) {
      values.push(input.tagId);
      conditions.push(`exists (select 1 from prework_respuesta_tags rt where rt.respuesta_id = r.id and rt.tag_id = $${values.length})`);
    }

    const { rows } = await pool.query<{
      id: string; mision_id: string; mision_titulo: string; mision_tipo: string;
      participante_id: string; participante_nombre: string; participante_email: string;
      contenido: unknown; archivos: unknown; estado: string; transcripcion: string | null;
      transcripcion_generada_at: string | null; analisis_ai: unknown; entregada_at: string | null;
    }>(
      `select r.id, r.mision_id, m.titulo as mision_titulo, m.tipo as mision_tipo,
              r.prework_participante_id as participante_id, p.nombre as participante_nombre, p.email as participante_email,
              r.contenido, r.archivos, r.estado, r.transcripcion, r.transcripcion_generada_at, r.analisis_ai, r.entregada_at
       from prework_respuestas r
       join prework_misiones m on m.id = r.mision_id
       join prework_participantes p on p.id = r.prework_participante_id
       where ${conditions.join(' and ')}
       order by r.entregada_at desc nulls last`,
      values,
    );
    if (rows.length === 0) return { respuestas: [] };

    const { rows: tagRows } = await pool.query<{ respuesta_id: string; id: string; nombre: string; color: string | null }>(
      `select rt.respuesta_id, t.id, t.nombre, t.color
       from prework_respuesta_tags rt
       join prework_tags t on t.id = rt.tag_id
       where rt.respuesta_id = any($1::uuid[])`,
      [rows.map(r => r.id)],
    );
    const tagsByRespuesta = new Map<string, { id: string; nombre: string; color?: string }[]>();
    for (const t of tagRows) {
      if (!tagsByRespuesta.has(t.respuesta_id)) tagsByRespuesta.set(t.respuesta_id, []);
      tagsByRespuesta.get(t.respuesta_id)!.push({ id: t.id, nombre: t.nombre, color: t.color ?? undefined });
    }

    return {
      respuestas: rows.map(r => ({
        id: r.id,
        misionId: r.mision_id,
        misionTitulo: r.mision_titulo,
        misionTipo: r.mision_tipo,
        participanteId: r.participante_id,
        participanteNombre: r.participante_nombre,
        participanteEmail: r.participante_email,
        contenido: r.contenido,
        archivos: r.archivos,
        estado: r.estado,
        transcripcion: r.transcripcion ?? undefined,
        transcripcionGeneradaAt: r.transcripcion_generada_at ?? undefined,
        analisisAi: r.analisis_ai ?? undefined,
        entregadaAt: r.entregada_at ?? undefined,
        tags: tagsByRespuesta.get(r.id) ?? [],
      })),
    };
  },
});
