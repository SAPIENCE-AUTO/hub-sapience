import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { guardarTranscripcionDeAssembly } from '../serverUtils/guardarTranscripcion';

// Minutas / notetaker (sep 2026): recibe el aviso de AssemblyAI cuando una
// transcripción termina — mismo contrato que ya usa Sharpli
// (assemblyWebhook.ts): AssemblyAI solo manda {transcript_id, status}, así
// que hay que volver a pedirle el resultado completo por separado.
// authenticated: false porque AssemblyAI llama esto directo, sin sesión —
// mismo criterio que Sharpli usa hoy (sin verificación de firma; la llave
// de la cuenta y la URL del webhook son el único secreto de por medio).
export default createEndpoint({
  authenticated: false,
  description: 'Recibe el aviso de AssemblyAI cuando termina de transcribir una minuta',
  inputSchema: z.object({
    transcript_id: z.string(),
    status: z.string(),
  }),
  outputSchema: z.object({ received: z.boolean() }),
  execute: async ({ input }) => {
    if (input.status !== 'completed' && input.status !== 'error') {
      return { received: true };
    }

    const { records } = await MeetingRecordings.findAll({ filters: { assemblyTranscriptId: input.transcript_id } });
    if (records.length === 0) return { received: true };
    const recording = records[0];

    if (input.status === 'error') {
      await MeetingRecordings.update({ id: recording.id, record: { status: 'transcription_error' } });
      return { received: true };
    }

    await guardarTranscripcionDeAssembly({ id: recording.id, recallBotId: recording.recallBotId }, input.transcript_id);

    return { received: true };
  },
});
