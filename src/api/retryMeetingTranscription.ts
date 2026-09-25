import { z } from 'zod';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';
import { attemptTranscriptionRecovery } from '../serverUtils/transcriptionRecovery';

// Minutas / notetaker (sep 2026): la subida normal manda el archivo en
// paralelo a Mux y a AssemblyAI (rápido, ver UploadMeetingRecordingDialog.tsx)
// — si el lado de AssemblyAI falla (red, etc.), la minuta se queda con video
// pero sin transcripción y nunca se reintenta sola. Este endpoint es el
// botón manual sobre attemptTranscriptionRecovery (transcriptionRecovery.ts)
// — el barrido automático en getMinutasOverview.ts usa la misma función
// para intentarlo solo, sin que nadie tenga que darle clic.
export default createEndpoint({
  authenticated: true,
  description: 'Reintenta la transcripción de una minuta cuyo video ya está listo pero nunca se transcribió',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ status: z.enum(['started', 'pending', 'skipped']) }),
  execute: async ({ input }) => {
    const recording = await MeetingRecordings.findOne({ id: input.id });
    if (!recording) throw new ZiteError({ code: 'NOT_FOUND', message: 'Minuta no encontrada' });
    if (!recording.muxPlaybackId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'El video todavía no está listo' });
    }
    if (recording.assemblyTranscriptId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'La transcripción ya se había iniciado' });
    }
    if (!recording.muxAssetId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Falta el asset de video' });
    }

    const status = await attemptTranscriptionRecovery(recording);
    return { status };
  },
});
