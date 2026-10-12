// Guardar el resultado de una transcripción de AssemblyAI en su minuta. Lo usan dos caminos: el aviso de AssemblyAI
// (src/api/assemblyaiWebhook.ts) y el barrido que le pregunta directo cuando ese aviso nunca llegó
// (src/api/getMinutasOverview.ts). Una sola definición, para que los dos guarden exactamente lo mismo.
import { MeetingRecordings } from '../../server/compat';
import { formatTranscript, getAssemblyTranscript, type AssemblyTranscript } from './assemblyAiClient';
import { getRecallBot, getRecallSpeakerTimeline, type RecallSpeakerTimelineSegment } from './recallClient';
import { mergeSpeakerNames } from './speakerNameMerge';

export interface MinutaPorGuardar {
  id: string;
  /** Solo las minutas de notetaker tienen un bot de Recall del que sacar los nombres reales. */
  recallBotId?: string | null;
}

/** Lo que el guardado necesita del exterior, para poder probarlo sin red ni base de datos. */
export interface DependenciasDeGuardado {
  obtenerTranscripcion: (transcriptId: string) => Promise<AssemblyTranscript>;
  /** Quién habló cuándo según Recall. */
  lineaDeTiempo: (recallBotId: string) => Promise<RecallSpeakerTimelineSegment[] | undefined>;
  guardar: (id: string, campos: Record<string, unknown>) => Promise<void>;
}

const REALES: DependenciasDeGuardado = {
  obtenerTranscripcion: getAssemblyTranscript,
  lineaDeTiempo: async botId => getRecallSpeakerTimeline(await getRecallBot(botId)),
  guardar: async (id, campos) => {
    await MeetingRecordings.update({ id, record: campos as never });
  },
};

export type ResultadoGuardado = 'guardada' | 'pendiente' | 'error';

/**
 * Le pide a AssemblyAI el resultado de `transcriptId` y, si ya terminó, lo guarda en la minuta (texto, turnos con el
 * nombre real de cada quien y palabras con su tiempo). 'pendiente' si todavía está trabajando; 'error' si AssemblyAI
 * no pudo transcribir (la minuta queda marcada como transcription_error).
 */
export async function guardarTranscripcionDeAssembly(
  minuta: MinutaPorGuardar,
  transcriptId: string,
  deps: DependenciasDeGuardado = REALES,
): Promise<ResultadoGuardado> {
  const data = await deps.obtenerTranscripcion(transcriptId);
  if (data.status === 'error') {
    await deps.guardar(minuta.id, { status: 'transcription_error' });
    return 'error';
  }
  if (data.status !== 'completed') return 'pendiente';

  let utterances = data.utterances ?? [];
  // Mejor esfuerzo: si Recall falla por lo que sea, el texto se guarda igual con las etiquetas genéricas de
  // AssemblyAI en vez de perder la transcripción por un dato extra. Las minutas subidas a mano no tienen bot y se
  // quedan con esas etiquetas, que es lo único posible ahí.
  if (minuta.recallBotId) {
    try {
      utterances = mergeSpeakerNames(utterances, await deps.lineaDeTiempo(minuta.recallBotId));
    } catch (err) {
      console.error('[guardarTranscripcion] error trayendo nombres reales de Recall', (err as Error).message);
    }
  }

  // Tiempo de cada palabra, para resaltar la activa durante el playback y hacer seek exacto al dar clic en una; la
  // respuesta de AssemblyAI ya lo trae sin pedirlo aparte. Sin `speaker`: el visor las ubica dentro de su turno por
  // rango de tiempo.
  const words = (data.words ?? []).map(w => ({ text: w.text, start: w.start, end: w.end }));

  await deps.guardar(minuta.id, {
    transcript: formatTranscript({ ...data, utterances }),
    transcriptData: { utterances, words },
  });
  return 'guardada';
}
