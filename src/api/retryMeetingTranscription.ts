import { z } from 'zod';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';
import { addStaticRendition } from '../../server/mux/client';
import { startAssemblyTranscription } from '../serverUtils/assemblyAiClient';

// Minutas / notetaker (sep 2026): la subida normal manda el archivo en
// paralelo a Mux y a AssemblyAI (rápido, ver UploadMeetingRecordingDialog.tsx)
// — si el lado de AssemblyAI falla (red, etc.), la minuta se queda con video
// pero sin transcripción y nunca se reintenta sola. Este endpoint repite el
// intento a partir del video que YA está en Mux, sin pedir el archivo de
// nuevo: primero intenta el rendition de audio si por algún motivo ya existe
// (poco probable, la subida normal no lo pide), y si no, se lo pide a Mux
// ahora mismo — solo en este camino de reintento se paga ese costo extra de
// tiempo, no en cada subida. video.asset.static_rendition.ready
// (server/webhooks/mux.ts) termina el trabajo cuando esté listo.
export default createEndpoint({
  authenticated: true,
  description: 'Reintenta la transcripción de una minuta cuyo video ya está listo pero nunca se transcribió',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ status: z.enum(['started', 'pending']) }),
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

    const probeUrl = `https://stream.mux.com/${recording.muxPlaybackId}/audio.m4a`;
    const probe = await fetch(probeUrl, { method: 'GET', headers: { Range: 'bytes=0-1' } }).catch(() => null);
    if (probe && (probe.ok || probe.status === 206)) {
      const transcriptId = await startAssemblyTranscription(probeUrl);
      await MeetingRecordings.update({ id: input.id, record: { assemblyTranscriptId: transcriptId } });
      return { status: 'started' };
    }

    await addStaticRendition(recording.muxAssetId, 'audio-only');
    return { status: 'pending' };
  },
});
