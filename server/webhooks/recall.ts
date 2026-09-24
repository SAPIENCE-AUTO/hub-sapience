import { Hono } from 'hono';
import { pool } from '../compat';
import { verifyRecallWebhookSignature, getRecallBot, botDownloadUrl } from '../../src/serverUtils/recallClient';
import { createAssetFromUrl } from '../mux/client';
import { startAssemblyTranscription } from '../../src/serverUtils/assemblyAiClient';
import { suggestMeetingLink } from '../../src/serverUtils/matchMeetingToEntity';

/**
 * POST /api/webhooks/recall — sub-app dedicada (igual que webhooks/mux.ts):
 * la verificación de firma necesita el body CRUDO, y el dispatcher genérico
 * de server/index.ts ya lo consume con c.req.json() antes de que esto lo vea.
 *
 * Solo actualiza `meeting_recordings` conforme el bot avanza — la fila ya
 * existe desde que se creó el bot (ver src/api/addNotetakerToMeeting.ts).
 * En `bot.done` dispara, en paralelo: la ingesta a Mux (video permanente) y
 * la transcripción en AssemblyAI (src/api/assemblyaiWebhook.ts recibe el
 * resultado) — mismo downloadUrl para ambas, ninguna depende de la otra.
 */
export const recallWebhookApp = new Hono();

interface RecallEvent {
  event: string;
  data: { bot: { id: string } };
}

recallWebhookApp.post('/webhooks/recall', async (c) => {
  const rawBody = await c.req.text();

  const verified = verifyRecallWebhookSignature(
    rawBody,
    c.req.header('Webhook-Id'),
    c.req.header('Webhook-Timestamp'),
    c.req.header('Webhook-Signature'),
  );
  if (!verified) {
    return c.json({ message: 'Firma inválida' }, 401);
  }

  let event: RecallEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  const botId = event.data?.bot?.id;
  if (!botId) return c.json({ ok: true }); // evento sin bot (breakout rooms, etc.) — no nos interesa

  // status guarda el sufijo del evento tal cual ("done", "in_call_recording",
  // etc.) — mismo vocabulario que status_changes de la API, para no inventar
  // uno propio.
  const status = event.event.replace(/^bot\./, '');

  try {
    await pool.query(`update meeting_recordings set status = $1, updated_at = now() where recall_bot_id = $2`, [status, botId]);

    if (event.event === 'bot.done') {
      const bot = await getRecallBot(botId);
      const downloadUrl = botDownloadUrl(bot);
      if (downloadUrl) {
        await pool.query(`update meeting_recordings set recall_download_url = $1, status = 'processing' where recall_bot_id = $2`, [downloadUrl, botId]);

        const asset = await createAssetFromUrl(downloadUrl);
        await pool.query(`update meeting_recordings set mux_asset_id = $1 where recall_bot_id = $2`, [asset.id, botId]);

        // Si AssemblyAI falla, el video en Mux ya quedó a salvo — no se
        // revierte nada de lo anterior por esto.
        try {
          const transcriptId = await startAssemblyTranscription(downloadUrl);
          await pool.query(`update meeting_recordings set assembly_transcript_id = $1 where recall_bot_id = $2`, [transcriptId, botId]);
        } catch (err) {
          console.error('[webhooks/recall] error iniciando transcripción', (err as Error).message);
        }

        // Match por naming, mejor esfuerzo — si falla o no encuentra nada, la
        // minuta queda sin vínculo y se resuelve a mano (linkMeetingRecording.ts).
        try {
          const { rows } = await pool.query<{ subject: string | null }>(`select subject from meeting_recordings where recall_bot_id = $1`, [botId]);
          const suggestion = await suggestMeetingLink(rows[0]?.subject ?? '');
          if (suggestion.projectId) {
            await pool.query(`update meeting_recordings set project_id = $1 where recall_bot_id = $2`, [suggestion.projectId, botId]);
          } else if (suggestion.dealId) {
            await pool.query(`update meeting_recordings set deal_id = $1 where recall_bot_id = $2`, [suggestion.dealId, botId]);
          }
        } catch (err) {
          console.error('[webhooks/recall] error sugiriendo vínculo', (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error(`[webhooks/recall] error procesando ${event.event}`, (err as Error).message);
    return c.json({ message: 'Error interno' }, 500);
  }

  return c.json({ ok: true });
});
