import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
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
  }),
  outputSchema: z.object({
    botId: z.string(),
  }),
  execute: async ({ input, context }) => {
    // bot_name tiene un máximo de 100 caracteres en la API de Recall.
    const botName = input.subject ? `Sapience Notetaker — ${input.subject}`.slice(0, 100) : undefined;
    const bot = await createRecallBot(input.meetingUrl, botName);

    await MeetingRecordings.create({
      record: {
        recallBotId: bot.id,
        subject: input.subject ?? 'Sin título',
        ownerEmail: context.user!.email,
        meetingStart: input.meetingStart,
        meetingEnd: input.meetingEnd,
        status: 'joining',
      },
    });

    return { botId: bot.id };
  },
});
