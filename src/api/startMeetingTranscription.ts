import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { startAssemblyTranscription } from '../serverUtils/assemblyAiClient';

// Minutas / notetaker (sep 2026): arranca la transcripción de una minuta
// subida a mano, una vez que el navegador ya subió el archivo a AssemblyAI
// vía el relay del servidor (server/assemblyRelay.ts → uploadUrl temporal de
// AssemblyAI). Separado de createMuxUploadUrl.ts porque esa subida a
// AssemblyAI corre en PARALELO con la subida a Mux (ver
// UploadMeetingRecordingDialog.tsx) — no se sabe si terminó hasta que el
// navegador lo confirma, así que no puede arrancar en el mismo endpoint que
// crea la fila.
export default createEndpoint({
  authenticated: true,
  description: 'Arranca la transcripción de una minuta ya subida a AssemblyAI',
  inputSchema: z.object({
    recordingId: z.string(),
    assemblyUploadUrl: z.string(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const transcriptId = await startAssemblyTranscription(input.assemblyUploadUrl);
    await MeetingRecordings.update({ id: input.recordingId, record: { assemblyTranscriptId: transcriptId } });
    return { ok: true };
  },
});
