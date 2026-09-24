import { z } from 'zod';
import OpenAI from 'openai';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';
import { MEETING_TYPES, getMeetingSummaryPrompt, type MeetingType } from '../serverUtils/meetingSummaryPrompts';

const AcuerdoSchema = z.object({
  texto: z.string(),
  responsable: z.string().nullable().optional(),
  hecho: z.boolean(),
});
const SummarySchema = z.object({
  resumen: z.string(),
  acuerdos: z.array(AcuerdoSchema),
});

// Minutas / notetaker (sep 2026): mismo patrón que analizarPreworkRespuesta.ts
// (OpenAI SDK + response_format json_object + zod.parse sobre la respuesta) —
// lo único distinto es que el system prompt cambia según meetingType, ver
// meetingSummaryPrompts.ts. meetingType se manda en cada llamada (no se lee
// solo de la fila) para permitir re-generar el resumen si se eligió mal el
// tipo la primera vez.
export default createEndpoint({
  authenticated: true,
  description: 'Genera el resumen y los acuerdos (action items) de una minuta con IA, según el tipo de junta indicado',
  inputSchema: z.object({
    meetingRecordingId: z.string(),
    meetingType: z.enum(MEETING_TYPES as [MeetingType, ...MeetingType[]]),
  }),
  outputSchema: SummarySchema,
  execute: async ({ input }) => {
    const recording = await MeetingRecordings.findOne({ id: input.meetingRecordingId });
    if (!recording) throw new ZiteError({ code: 'NOT_FOUND', message: 'Minuta no encontrada' });
    if (!recording.transcript?.trim()) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esta minuta todavía no tiene transcripción lista' });
    }

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      // Mismo modelo que Sharpli usa para este tipo de resumen exhaustivo
      // (generateSummary.ts) — gpt-4o generaba salidas más cortas de lo
      // pedido. max_tokens explícito por la misma razón: Sharpli lo fija en
      // 6000 a propósito, sin eso el resumen puede cortarse a media
      // sección en una junta larga.
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: getMeetingSummaryPrompt(input.meetingType) },
        { role: 'user', content: `Transcripción de la junta:\n\n${recording.transcript}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 6000,
    });

    const parsed = SummarySchema.parse(JSON.parse(completion.choices[0].message.content ?? '{}'));

    await MeetingRecordings.update({
      id: input.meetingRecordingId,
      record: { meetingType: input.meetingType, summaryJson: parsed },
    });

    return parsed;
  },
});
