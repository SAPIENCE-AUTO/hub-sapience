import { z } from 'zod';
import OpenAI from 'openai';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

const analisisSchema = z.object({
  resumen: z.string(),
  sentimiento: z.enum(['positivo', 'neutral', 'negativo']),
  tagsSugeridos: z.array(z.string()),
});

/** Análisis IA de una sola respuesta (resumen + sentimiento + tags sugeridos). Mismo patrón que analyzeRecruitmentStatus.ts. */
export default createEndpoint({
  authenticated: true,
  description: 'Genera resumen/sentimiento/tags sugeridos de una respuesta de Prework con IA',
  inputSchema: z.object({ respuestaId: z.string() }),
  outputSchema: analisisSchema,
  execute: async ({ input }) => {
    const { rows } = await pool.query<{
      contenido: { texto?: string }; transcripcion: string | null; mision_titulo: string; mision_descripcion: string | null;
    }>(
      `select r.contenido, r.transcripcion, m.titulo as mision_titulo, m.descripcion as mision_descripcion
       from prework_respuestas r join prework_misiones m on m.id = r.mision_id
       where r.id = $1`,
      [input.respuestaId],
    );
    const respuesta = rows[0];
    if (!respuesta) throw new ZiteError({ code: 'NOT_FOUND', message: 'Respuesta no encontrada' });

    const texto = respuesta.transcripcion || respuesta.contenido?.texto || '';
    if (!texto.trim()) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No hay texto para analizar — transcribe primero si es audio/video' });
    }

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Eres un analista de investigación de mercados cualitativa. Responde ÚNICAMENTE con JSON válido, sin markdown.' },
        {
          role: 'user',
          content: `Misión: "${respuesta.mision_titulo}"${respuesta.mision_descripcion ? ` — ${respuesta.mision_descripcion}` : ''}\n\n`
            + `Respuesta del participante:\n${texto}\n\n`
            + `Devuelve JSON: { "resumen": "una o dos líneas", "sentimiento": "positivo"|"neutral"|"negativo", "tagsSugeridos": ["hasta 4 palabras/frases cortas"] }`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = analisisSchema.parse(JSON.parse(completion.choices[0].message.content ?? '{}'));

    await pool.query(
      `update prework_respuestas set analisis_ai = $1, estado = 'revisada', updated_at = now() where id = $2`,
      [JSON.stringify(parsed), input.respuestaId],
    );

    return parsed;
  },
});
