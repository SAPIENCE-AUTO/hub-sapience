import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { getAssemblyTranscript, formatTranscript } from '../serverUtils/assemblyAiClient';
import { getRecallBot, getRecallSpeakerTimeline } from '../serverUtils/recallClient';
import { mergeSpeakerNames } from '../serverUtils/speakerNameMerge';

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

    const data = await getAssemblyTranscript(input.transcript_id);
    if (data.status !== 'completed') return { received: true };

    let utterances = data.utterances ?? [];
    // Solo minutas de notetaker tienen un bot de Recall del que sacar
    // nombres reales — las subidas a mano no tienen esa metadata y se
    // quedan con las etiquetas genéricas de AssemblyAI, que es lo único
    // posible ahí. Mejor esfuerzo: si Recall falla por lo que sea, la
    // transcripción se guarda igual con las etiquetas genéricas en vez de
    // perder el resultado de AssemblyAI por un problema en un dato extra.
    if (recording.recallBotId) {
      try {
        const bot = await getRecallBot(recording.recallBotId);
        const timeline = await getRecallSpeakerTimeline(bot);
        utterances = mergeSpeakerNames(utterances, timeline);
      } catch (err) {
        console.error('[assemblyaiWebhook] error trayendo nombres reales de Recall', (err as Error).message);
      }
    }

    // Timestamps por palabra, para resaltar la palabra activa durante el
    // playback y hacer seek exacto al dar clic en una — mismo dato que ya
    // trae la respuesta de AssemblyAI sin pedirlo aparte (ver
    // assemblyAiClient.ts). Sin `speaker` — MeetingSyncedTranscript.tsx las
    // ubica dentro de su utterance por rango de tiempo, no por speaker.
    const words = (data.words ?? []).map(w => ({ text: w.text, start: w.start, end: w.end }));

    await MeetingRecordings.update({
      id: recording.id,
      record: {
        transcript: formatTranscript({ ...data, utterances }),
        transcriptData: { utterances, words },
      },
    });

    return { received: true };
  },
});
