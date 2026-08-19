import { Hono } from 'hono';
import { pool } from '../compat';
import { verifyMuxWebhookSignature } from '../mux/client';
import { publishEvent } from '../../src/lib/ably';

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
  data: { id: string; live_stream_id?: string };
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
        if (event.data.live_stream_id) {
          await pool.query(
            `update observation_sessions set mux_asset_id = $1, updated_at = now() where mux_live_stream_id = $2`,
            [event.data.id, event.data.live_stream_id],
          );
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
