import { Hono } from 'hono';
import { pool } from '../compat';
import { verifyMuxWebhookSignature, getAsset } from '../mux/client';
import { publishEvent } from '../../src/lib/ably';
import { startAssemblyTranscription } from '../../src/serverUtils/assemblyAiClient';

/**
 * POST /api/webhooks/mux — sub-app dedicada, NO pasa por el dispatcher
 * genérico de server/index.ts (igual que server/upload.ts con multipart):
 * la verificación de firma HMAC necesita el body CRUDO, y el dispatcher
 * genérico ya lo consume con `c.req.json()` antes de que este código lo vea.
 *
 * Así se actualiza `estado` solo (video.live_stream.active/idle,
 * video.asset.ready) — nunca depende de que alguien lo cambie a mano.
 */
export const muxWebhookApp = new Hono();

interface MuxEvent {
  type: string;
  data: { id: string; asset_id?: string; upload_id?: string; live_stream_id?: string; playback_ids?: Array<{ id: string; policy: string }> };
}

muxWebhookApp.post('/webhooks/mux', async (c) => {
  const rawBody = await c.req.text();

  let verified: boolean;
  try {
    verified = verifyMuxWebhookSignature(rawBody, c.req.header('Mux-Signature'));
  } catch (err) {
    console.error('[webhooks/mux] error verificando firma', (err as Error).message);
    return c.json({ message: 'No se pudo verificar la firma' }, 500);
  }
  if (!verified) {
    return c.json({ message: 'Firma inválida' }, 401);
  }

  let event: MuxEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  // 200 aunque no encontremos la sesión: Mux reintenta agresivo sobre
  // cualquier respuesta que no sea 2xx, y una sesión ya borrada (o un evento
  // de un live stream ajeno a este módulo) no debe generar reintentos
  // infinitos.
  try {
    switch (event.type) {
      case 'video.live_stream.active': {
        const { rows } = await pool.query(
          `update observation_sessions set estado = 'vivo', started_at = now(), updated_at = now()
           where mux_live_stream_id = $1 returning id`,
          [event.data.id],
        );
        if (rows[0]) await publishEvent(`observation:${rows[0].id}`, 'session.state', { estado: 'vivo' });
        break;
      }
      case 'video.live_stream.idle': {
        const { rows } = await pool.query(
          `update observation_sessions set estado = 'terminada', ended_at = now(), updated_at = now()
           where mux_live_stream_id = $1 returning id`,
          [event.data.id],
        );
        if (rows[0]) await publishEvent(`observation:${rows[0].id}`, 'session.state', { estado: 'terminada' });
        break;
      }
      case 'video.asset.ready': {
        // `mux_asset_id` (el recurso) no sirve para reproducir — mux-player
        // necesita el playback_id del asset, un recurso distinto. Sin esto
        // guardado, la sesión "terminada" nunca puede ofrecer la grabación.
        if (event.data.live_stream_id) {
          const playbackId = event.data.playback_ids?.[0]?.id ?? null;
          await pool.query(
            `update observation_sessions set mux_asset_id = $1, mux_asset_playback_id = $2, updated_at = now() where mux_live_stream_id = $3`,
            [event.data.id, playbackId, event.data.live_stream_id],
          );
        }
        // Minutas / notetaker: mismo evento, pero acá el asset puede venir de
        // dos orígenes distintos — createAssetFromUrl (notetaker, recall.ts:
        // ya conoce mux_asset_id desde que se creó) o Direct Upload (subida
        // manual, createMuxUploadUrl.ts: solo conoce mux_upload_id hasta este
        // momento). Por eso el match es por cualquiera de los dos, y
        // mux_asset_id se rellena aquí si todavía no estaba.
        //
        // La transcripción de la subida manual YA NO depende de este evento
        // (antes esperaba a un static rendition de audio, que retrasaba todo
        // el proceso) — el navegador manda el mismo archivo en paralelo a
        // AssemblyAI vía el relay del servidor (ver
        // UploadMeetingRecordingDialog.tsx / server/assemblyRelay.ts), así
        // que este evento solo marca el video como reproducible.
        {
          const playbackId = event.data.playback_ids?.[0]?.id ?? null;
          await pool.query(
            `update meeting_recordings
             set mux_asset_id = coalesce(mux_asset_id, $1),
                 mux_playback_id = $2,
                 status = 'ready',
                 updated_at = now()
             where mux_asset_id = $1 or mux_upload_id = $3`,
            [event.data.id, playbackId, event.data.upload_id ?? null],
          );
        }
        break;
      }
      case 'video.asset.static_rendition.ready': {
        // Solo relevante para retryMeetingTranscription.ts (el rendition se
        // pide a mano ahí cuando el intento en paralelo con AssemblyAI
        // falló) — la subida normal nunca pide renditions, así que este
        // evento no le llega a nada más. Se re-consulta el asset completo en
        // vez de confiar en la forma exacta del payload del webhook (sin
        // documentar a detalle) — mismo criterio que server/webhooks/recall.ts.
        const assetId = event.data.asset_id ?? event.data.id;
        const { rows } = await pool.query<{ id: string; mux_playback_id: string | null }>(
          `select id, mux_playback_id from meeting_recordings where mux_asset_id = $1 and assembly_transcript_id is null`,
          [assetId],
        );
        const recording = rows[0];
        if (recording?.mux_playback_id) {
          try {
            const asset = await getAsset(assetId);
            const audioFile = asset.static_renditions?.files.find(f => f.resolution === 'audio-only' && f.status === 'ready');
            if (audioFile) {
              const audioUrl = `https://stream.mux.com/${recording.mux_playback_id}/${audioFile.name}`;
              const transcriptId = await startAssemblyTranscription(audioUrl);
              await pool.query(
                `update meeting_recordings set assembly_transcript_id = $1, updated_at = now() where id = $2`,
                [transcriptId, recording.id],
              );
            }
          } catch (err) {
            console.error('[webhooks/mux] error iniciando transcripción desde static rendition', (err as Error).message);
          }
        }
        break;
      }
      default:
        break; // otros eventos de Mux no nos interesan
    }
  } catch (err) {
    console.error(`[webhooks/mux] error procesando ${event.type}`, (err as Error).message);
    return c.json({ message: 'Error interno' }, 500);
  }

  return c.json({ ok: true });
});
