import { z } from 'zod';
import OpenAI from 'openai';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

const analisisSchema = z.object({
  resumenGeneral: z.string(),
  temasPrincipales: z.array(z.object({ tema: z.string(), detalle: z.string() })),
  alertas: z.array(z.string()),
});

/**
 * Análisis agregado de todas las respuestas (con texto) de un estudio de
 * Prework. A diferencia de analizarPreworkRespuesta, este NO se persiste —
 * se calcula al vuelo cada vez que se pide. Persistirlo (como
 * Projects.lastAnalysisJson) necesitaría una columna nueva en
 * prework_estudios; se deja fuera de esta fase a propósito, es un recorte
 * de alcance consciente, no un olvido.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Análisis IA agregado de todas las respuestas con texto de un estudio de Prework',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: analisisSchema,
  execute: async ({ input }) => {
    const { rows } = await pool.query<{ mision_titulo: string; participante_nombre: string; texto: string }>(
      `select m.titulo as mision_titulo, p.nombre as participante_nombre,
              coalesce(nullif(r.transcripcion, ''), r.contenido->>'texto', '') as texto
       from prework_respuestas r
       join prework_misiones m on m.id = r.mision_id
       join prework_participantes p on p.id = r.prework_participante_id
       where r.prework_estudio_id = $1
       order by r.entregada_at desc
       limit 300`,
      [input.estudioId],
    );
    const conTexto = rows.filter(r => r.texto.trim());
    if (conTexto.length === 0) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No hay respuestas con texto todavía para analizar' });
    }

    const resumenEntradas = conTexto.map(r => `[${r.mision_titulo} — ${r.participante_nombre}]: ${r.texto.slice(0, 600)}`).join('\n\n');

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Eres un analista de investigación de mercados cualitativa. Responde ÚNICAMENTE con JSON válido, sin markdown.' },
        {
          role: 'user',
          content: `Estas son ${conTexto.length} respuestas de participantes a distintas misiones de un mismo estudio (diario/prework):\n\n${resumenEntradas}\n\n`
            + `Devuelve JSON: { "resumenGeneral": "3-4 líneas", "temasPrincipales": [{ "tema": "...", "detalle": "..." }] (máximo 6), "alertas": ["cosas que ameritan seguimiento del equipo, si las hay"] }`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 4096,
    });

    return analisisSchema.parse(JSON.parse(completion.choices[0].message.content ?? '{}'));
  },
});
