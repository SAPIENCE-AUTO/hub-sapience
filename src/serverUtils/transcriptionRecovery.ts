import { MeetingRecordings } from '../../server/compat';
import { addStaticRendition } from '../../server/mux/client';
import { startAssemblyTranscription } from './assemblyAiClient';
import { withRetries } from './retry';

interface RecoverableRecording {
  id: string;
  muxPlaybackId?: string;
  muxAssetId?: string;
}

/**
 * Único lugar que sabe recuperar una minuta con video listo pero sin
 * transcripción — usado tanto por retryMeetingTranscription.ts (botón
 * manual) como por el barrido automático de getMinutasOverview.ts (self
 * -heal, sin que nadie tenga que pedirlo). Antes esta lógica solo vivía en
 * el endpoint manual; duplicarla para el barrido automático habría sido el
 * mismo bug de mantenimiento en dos lugares.
 */
export async function attemptTranscriptionRecovery(
  recording: RecoverableRecording,
): Promise<'started' | 'pending' | 'skipped'> {
  if (!recording.muxPlaybackId || !recording.muxAssetId) return 'skipped';

  const probeUrl = `https://stream.mux.com/${recording.muxPlaybackId}/audio.m4a`;
  const probe = await fetch(probeUrl, { method: 'GET', headers: { Range: 'bytes=0-1' } }).catch(() => null);

  if (probe && (probe.ok || probe.status === 206)) {
    const transcriptId = await withRetries(() => startAssemblyTranscription(probeUrl));
    await MeetingRecordings.update({
      id: recording.id,
      record: { assemblyTranscriptId: transcriptId, status: 'processing' },
    });
    return 'started';
  }

  await addStaticRendition(recording.muxAssetId, 'audio-only');
  await MeetingRecordings.update({ id: recording.id, record: { status: 'processing' } });
  return 'pending';
}
