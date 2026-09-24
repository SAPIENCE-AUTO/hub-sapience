import { z } from 'zod';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';

// Minutas / notetaker (sep 2026): vínculo manual a Proyecto o Deal/Brief —
// siempre disponible, sea que el match automático por naming (bot.done en
// server/webhooks/recall.ts) haya acertado, fallado, o no haya corrido
// (grabaciones creadas antes de esa lógica). Exactamente uno de los dos, o
// ninguno para desvincular.
export default createEndpoint({
  authenticated: true,
  description: 'Vincula (o desvincula) una minuta a un Proyecto o a un Deal',
  inputSchema: z.object({
    meetingRecordingId: z.string(),
    projectId: z.string().nullable().optional(),
    dealId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    if (input.projectId && input.dealId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Una minuta se vincula a un Proyecto o a un Deal, no a los dos' });
    }

    const recording = await MeetingRecordings.findOne({ id: input.meetingRecordingId });
    if (!recording) throw new ZiteError({ code: 'NOT_FOUND', message: 'Minuta no encontrada' });

    await MeetingRecordings.update({
      id: input.meetingRecordingId,
      record: {
        project: input.projectId ?? null,
        deal: input.dealId ?? null,
      },
    });

    return { ok: true };
  },
});
