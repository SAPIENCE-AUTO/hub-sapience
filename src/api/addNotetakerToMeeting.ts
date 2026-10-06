import { z } from 'zod';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';
import { createRecallBot } from '../serverUtils/recallClient';

// Piloto notetaker (sep 2026): "Agregar notetaker a la junta" — manda un bot
// de Recall.ai a la junta YA (sin join_at, se une de inmediato). Mismo
// endpoint sirve tanto para el primer intento como para reintentar si al
// bot lo sacaron de la junta — no hay diferencia real entre ambos casos
// (cada click crea un bot y una fila de meeting_recordings propios; si el
// primer intento se cortó a medias, queda su propia fila con lo que alcanzó
// a grabar, separada del reintento).
//
// La fila en meeting_recordings se crea aquí mismo (no en el webhook de
// Recall) para no depender de que el webhook llegue para saber que la junta
// existe — server/webhooks/recall.ts solo la actualiza conforme avanza.
export default createEndpoint({
  authenticated: true,
  description: 'Piloto notetaker: crea un bot de Recall.ai que se une a la junta de inmediato, y la fila de meeting_recordings correspondiente',
  inputSchema: z.object({
    meetingUrl: z.string(),
    subject: z.string().optional(),
    meetingStart: z.string().optional(),
    meetingEnd: z.string().optional(),
    graphEventId: z.string().optional(),
  }),
  outputSchema: z.object({
    botId: z.string(),
    recordingId: z.string(),
  }),
  execute: async ({ input, context }) => {
    // bot_name tiene un máximo de 100 caracteres en la API de Recall.
    const botName = input.subject ? `Sapience Notetaker — ${input.subject}`.slice(0, 100) : undefined;
    // Cualquier excepción que no sea ZiteError llega al front como «Error interno» sin motivo. Aquí el motivo
    // casi siempre es de Recall (URL de junta no válida, plataforma no soportada, límite del plan…), así que
    // se devuelve legible para que la persona sepa qué pasó.
    let bot;
    try {
      bot = await createRecallBot(input.meetingUrl, botName);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      console.error('[addNotetakerToMeeting] Recall falló', { meetingUrl: input.meetingUrl, detalle });
      const motivo = /meeting_url/i.test(detalle) ? 'El enlace de la junta no es válido o no es de una plataforma soportada (Teams, Zoom o Meet).'
        : /\(40[13]\)/.test(detalle) ? 'Recall rechazó las credenciales del Hub.'
        : /\(402\)|\(429\)/.test(detalle) ? 'Recall rechazó la solicitud por límite o plan.'
        : 'Recall no pudo crear el notetaker.';
      throw new ZiteError({ code: 'BAD_REQUEST', message: `${motivo} Detalle: ${detalle.slice(0, 250)}` });
    }

    const recording = await MeetingRecordings.create({
      record: {
        recallBotId: bot.id,
        graphEventId: input.graphEventId,
        subject: input.subject ?? 'Sin título',
        ownerEmail: context.user!.email,
        meetingStart: input.meetingStart,
        meetingEnd: input.meetingEnd,
        status: 'joining',
      },
    });

    return { botId: bot.id, recordingId: recording.id };
  },
});
