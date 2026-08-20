import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../compat';
import { publishEvent } from '../../src/lib/ably';

/**
 * POST /api/webhooks/zoom — sub-app dedicada, NO pasa por el dispatcher
 * genérico de server/index.ts (mismo motivo que server/webhooks/mux.ts: la
 * verificación de firma necesita el body crudo).
 *
 * Hoy solo escucha `meeting.chat_message_sent` — el chat DENTRO de la
 * reunión de Zoom, para que las respuestas del moderador aparezcan también
 * en el chat de la Sala de observación (CLAUDE (1).md/decisiones de este
 * chat: mandar hacia Zoom no es posible con la API pública, pero leer desde
 * Zoom sí parece estarlo). Este evento es conocido por ser poco confiable en
 * algunas cuentas (requiere DLP habilitado, y varios developers reportan que
 * no siempre dispara) — se deja un log del payload completo la primera vez
 * que llegue algo, para ajustar los nombres de campo exactos contra la
 * realidad en vez de contra la documentación pública (incompleta en esto).
 */
export const zoomWebhookApp = new Hono();

function requireWebhookSecret(): string {
  const v = process.env.ZITE_ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!v) throw new Error('Falta la variable de entorno ZITE_ZOOM_WEBHOOK_SECRET_TOKEN');
  return v;
}

interface ZoomWebhookPayload {
  event: string;
  payload?: {
    plainToken?: string;
    object?: {
      id?: number | string;
      meeting_id?: number | string;
      chat_message?: { message?: string; content?: string; sender_name?: string; sender?: string };
      message?: string;
      sender_name?: string;
    };
  };
}

zoomWebhookApp.post('/webhooks/zoom', async (c) => {
  const rawBody = await c.req.text();

  let payload: ZoomWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  // Challenge-response que Zoom manda UNA vez, al validar la URL desde su
  // dashboard — sin firma todavía (es lo que la prueba).
  if (payload.event === 'endpoint.url_validation') {
    const plainToken = payload.payload?.plainToken;
    if (!plainToken) return c.json({ message: 'Falta plainToken' }, 400);
    let secret: string;
    try {
      secret = requireWebhookSecret();
    } catch (err) {
      console.error('[webhooks/zoom]', (err as Error).message);
      return c.json({ message: 'Error interno' }, 500);
    }
    const encryptedToken = createHmac('sha256', secret).update(plainToken).digest('hex');
    return c.json({ plainToken, encryptedToken });
  }

  // Eventos reales: sí vienen firmados con x-zm-signature.
  const timestamp = c.req.header('x-zm-request-timestamp');
  const signature = c.req.header('x-zm-signature');
  if (!timestamp || !signature) return c.json({ message: 'Falta firma' }, 401);

  try {
    const secret = requireWebhookSecret();
    const computed = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ message: 'Firma inválida' }, 401);
    }
  } catch (err) {
    console.error('[webhooks/zoom] error verificando firma', (err as Error).message);
    return c.json({ message: 'Error interno' }, 500);
  }

  try {
    if (payload.event === 'meeting.chat_message_sent') {
      await handleChatMessageSent(payload);
    }
    // otros eventos de Zoom no nos interesan hoy
  } catch (err) {
    console.error(`[webhooks/zoom] error procesando ${payload.event}`, (err as Error).message);
    return c.json({ message: 'Error interno' }, 500);
  }

  return c.json({ ok: true });
});

async function handleChatMessageSent(payload: ZoomWebhookPayload): Promise<void> {
  // Log completo mientras no está confirmado el shape real (la doc pública
  // de Zoom no lo detalla del todo) — quitar una vez confirmado en logs.
  console.log('[webhooks/zoom] meeting.chat_message_sent:', JSON.stringify(payload));

  const obj = payload.payload?.object ?? {};
  const chat = obj.chat_message ?? {};
  const zoomMeetingId = String(obj.id ?? obj.meeting_id ?? '');
  const messageText = chat.message ?? chat.content ?? obj.message ?? '';
  const senderName = chat.sender_name ?? chat.sender ?? obj.sender_name ?? 'Moderador';
  if (!zoomMeetingId || !messageText) return;

  const sessionResult = await pool.query(
    `select id from observation_sessions where zoom_meeting_id = $1`,
    [zoomMeetingId],
  );
  const sessionId = sessionResult.rows[0]?.id;
  if (!sessionId) return; // meeting no pertenece a ninguna Sala de observación

  const body = `[Zoom] ${senderName}: ${messageText}`;
  const inserted = await pool.query(
    `insert into observation_chat (session_id, body, es_productor) values ($1, $2, true) returning id, created_at`,
    [sessionId, body],
  );
  const message = inserted.rows[0];
  await publishEvent(`observation:${sessionId}`, 'chat.message', {
    id: message.id, nombre: 'Productor', esProductor: true, body, createdAt: message.created_at,
  });
}
