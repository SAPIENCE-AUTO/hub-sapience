import { z } from 'zod';
import OpenAI, { toFile } from 'openai';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

interface Archivo { url: string; name?: string; mimeType?: string }

export default createEndpoint({
  authenticated: true,
  description: 'Transcribe el archivo de audio/video de una respuesta de Prework (Whisper)',
  inputSchema: z.object({ respuestaId: z.string() }),
  outputSchema: z.object({ transcripcion: z.string() }),
  execute: async ({ input }) => {
    const { rows } = await pool.query<{ archivos: Archivo[] }>(
      `select archivos from prework_respuestas where id = $1`,
      [input.respuestaId],
    );
    const respuesta = rows[0];
    if (!respuesta) throw new ZiteError({ code: 'NOT_FOUND', message: 'Respuesta no encontrada' });

    const archivos = respuesta.archivos ?? [];
    const archivo = archivos.find(a => a.mimeType?.startsWith('audio/')) ?? archivos.find(a => a.mimeType?.startsWith('video/'));
    if (!archivo) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esta respuesta no tiene un archivo de audio/video para transcribir' });

    const fileResp = await fetch(archivo.url);
    if (!fileResp.ok) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo descargar el archivo a transcribir' });
    const buffer = Buffer.from(await fileResp.arrayBuffer());

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const file = await toFile(buffer, archivo.name ?? 'audio');
    const result = await client.audio.transcriptions.create({ file, model: 'gpt-4o-transcribe' });

    await pool.query(
      `update prework_respuestas set transcripcion = $1, transcripcion_generada_at = now(), updated_at = now() where id = $2`,
      [result.text, input.respuestaId],
    );

    return { transcripcion: result.text };
  },
});
