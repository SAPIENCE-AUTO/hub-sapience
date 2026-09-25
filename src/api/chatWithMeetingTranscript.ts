import { z } from 'zod';
import OpenAI from 'openai';
import { createEndpoint, MeetingRecordings, MeetingChatMessages, ZiteError } from '../../server/compat';

interface Utterance {
  speaker: string;
  text: string;
  start: number;
}

function msToTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Mismo formato que buildTimestampedTranscription en chatWithTranscription.ts
// de Sharpli — "[MM:SS] [speaker] texto" por turno, para que el modelo pueda
// citar el momento exacto. A diferencia de Sharpli, transcriptData ya llega
// como objeto (jsonb), no como string — no hace falta JSON.parse.
function buildTimestampedTranscript(recording: { transcriptData?: { utterances?: Utterance[] }; transcript?: string }): string {
  const utterances = recording.transcriptData?.utterances;
  if (!utterances?.length) return recording.transcript ?? '';
  return utterances.map(u => `[${msToTimecode(u.start)}] [${u.speaker}] ${u.text}`).join('\n');
}

// Puerto de chatWithTranscription.ts (Sharpli) — "también está en sharpli ya
// implementado" (Sergio). Sin RAG ni resumen: la transcripción completa
// (con timecodes) se manda tal cual como contexto en cada llamada, igual
// que el original — truncada a 80k caracteres como único límite de
// contexto. El historial de la conversación lo maneja el cliente (lo manda
// completo en cada mensaje, ver MeetingTranscriptChat.tsx) y cada turno se
// persiste aparte en MeetingChatMessages solo para poder recargar el
// historial al reabrir, no para reconstruir el prompt.
const SYSTEM_PROMPT = (transcription: string, title: string) => `Eres un asistente que ayuda a analizar el contenido de una junta.

Junta: "${title}"

La transcripción incluye timecodes en formato [MM:SS] al inicio de cada intervención.

Transcripción completa de la junta:
---
${transcription.slice(0, 80000)}
---

Instrucciones:
- Responde SIEMPRE en español
- Basa tus respuestas EXCLUSIVAMENTE en el contenido de la transcripción anterior
- Si el usuario pregunta algo que no está en la transcripción, indícalo claramente
- Puedes citar fragmentos textuales de la transcripción cuando sea relevante
- Tono analítico, claro y directo
- Cuando cites a alguien, usa su nombre tal como aparece en la transcripción
- Cuando el usuario pregunte en qué momento se habla de algo, SIEMPRE incluye el timecode exacto en tu respuesta usando el formato [MM:SS]
- Si hay múltiples momentos relevantes, lista todos con sus timecodes`;

export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Chat con IA sobre la transcripción de una minuta, respuesta por streaming',
  inputSchema: z.object({
    meetingRecordingId: z.string(),
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })),
    userMessage: z.string(),
  }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ input, stream }) => {
    const recording = await MeetingRecordings.findOne({ id: input.meetingRecordingId });
    if (!recording) throw new ZiteError({ code: 'NOT_FOUND', message: 'Minuta no encontrada' });

    const transcription = buildTimestampedTranscript(recording);
    if (!transcription.trim()) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esta minuta todavía no tiene transcripción' });
    }

    await MeetingChatMessages.create({
      record: { meetingRecording: input.meetingRecordingId, role: 'user', content: input.userMessage },
    });

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completionStream = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(transcription, recording.subject || 'Sin título') },
        ...input.messages.map(m => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    });

    let text = '';
    for await (const part of completionStream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        stream!.write({ text: delta });
      }
    }

    await MeetingChatMessages.create({
      record: { meetingRecording: input.meetingRecordingId, role: 'assistant', content: text },
    });

    return { text };
  },
});
