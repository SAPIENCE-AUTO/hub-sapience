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

// ── Qué minutas están atoradas y qué hacer con cada una ─────────────────────────────────────────────────────────

/** Cuánto se espera, sin cambios en la fila, antes de intentar rescatarla (el trámite normal tarda segundos o pocos minutos). */
export const ESPERA_ANTES_DE_RESCATAR_MS = 3 * 60 * 1000;
/** Cada cuánto, como máximo, se vuelve a intentar con la misma minuta (aunque varias personas tengan Minutas abierto). */
export const ENFRIAMIENTO_POR_MINUTA_MS = 60 * 1000;

export interface MinutaParaRevisar {
  transcript?: string | null;
  muxPlaybackId?: string | null;
  muxAssetId?: string | null;
  assemblyTranscriptId?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}

/**
 * - 'iniciar': el video ya está en Mux pero la transcripción nunca arrancó → se arranca (attemptTranscriptionRecovery).
 * - 'recoger': la transcripción ya se mandó a AssemblyAI pero su texto nunca llegó (el aviso se perdió o nunca se
 *   configuró) → se le pregunta directo a AssemblyAI y, si ya terminó, se guarda (guardarTranscripcionDeAssembly).
 * - null: no hace falta nada (ya tiene texto, está en trámite o AssemblyAI ya dijo que falló).
 */
export type AccionDeRescate = 'iniciar' | 'recoger' | null;

export function accionDeRescate(r: MinutaParaRevisar, ahora: number): AccionDeRescate {
  if (r.transcript) return null;
  const sinCambios = r.updatedAt ? ahora - new Date(r.updatedAt).getTime() : 0;
  const pasoLaEspera = sinCambios > ESPERA_ANTES_DE_RESCATAR_MS;
  if (r.muxPlaybackId && r.muxAssetId && !r.assemblyTranscriptId && (r.status === 'transcription_error' || pasoLaEspera)) return 'iniciar';
  if (r.assemblyTranscriptId && r.status !== 'transcription_error' && pasoLaEspera) return 'recoger';
  return null;
}

const ultimosIntentos = new Map<string, number>();

/**
 * Reserva el turno para intentar rescatar una minuta: false si ya se intentó hace menos de `enfriamientoMs`. Evita que
 * cada actualización de la pantalla de Minutas (cada 60 s, de cada persona que la tenga abierta) repita la consulta.
 */
export function reservaIntento(id: string, ahora = Date.now(), enfriamientoMs = ENFRIAMIENTO_POR_MINUTA_MS): boolean {
  const ultimo = ultimosIntentos.get(id);
  if (ultimo !== undefined && ahora - ultimo < enfriamientoMs) return false;
  ultimosIntentos.set(id, ahora);
  // Los intentos viejos ya no frenan a nadie: se olvidan para que el mapa no crezca sin fin.
  for (const [k, t] of ultimosIntentos) if (ahora - t > 60 * enfriamientoMs) ultimosIntentos.delete(k);
  return true;
}
