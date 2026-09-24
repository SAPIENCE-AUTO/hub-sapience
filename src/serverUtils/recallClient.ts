// Cliente mínimo de la API de Recall.ai (piloto notetaker, sep 2026).
// Formato verificado contra la documentación real de Recall (docs.recall.ai),
// no adivinado: POST /api/v1/bot/ con header `Authorization: Token <key>`
// (no "Bearer" — Recall usa su propio esquema).
import { createHmac, timingSafeEqual } from 'node:crypto';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

function recallFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = requireEnv('RECALL_API_BASE_URL');
  const key = requireEnv('RECALL_API_KEY');
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Token ${key}`,
      'Content-Type': 'application/json',
    },
  });
}

export interface RecallBot {
  id: string;
  meeting_url: { meeting_id?: string; platform?: string } | string;
  status_changes: { code: string; sub_code: string | null; created_at: string }[];
  recordings?: { media_shortcuts?: { video_mixed?: { data?: { download_url?: string } } } }[];
}

/** Crea un bot que se une a la junta de inmediato (sin join_at = ahora). */
export async function createRecallBot(meetingUrl: string, botName = 'Sapience Notetaker'): Promise<RecallBot> {
  const res = await recallFetch('/api/v1/bot/', {
    method: 'POST',
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName,
      recording_config: { video_mixed_mp4: {} },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Recall rechazó la creación del bot (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export async function getRecallBot(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/api/v1/bot/${encodeURIComponent(botId)}/`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`No se pudo consultar el bot (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Último status_change del bot — "" si todavía no hay ninguno. */
export function latestBotStatus(bot: RecallBot): string {
  if (!bot.status_changes?.length) return '';
  return bot.status_changes[bot.status_changes.length - 1].code;
}

export function botDownloadUrl(bot: RecallBot): string | undefined {
  // Recall regresa `download_url: null` explícito mientras la grabación no
  // está lista (no lo omite) — el zod outputSchema de getNotetakerBotStatus
  // usa .optional() (permite undefined, no null), así que sin este ?? el
  // polling truena en cada tick hasta que termina la junta.
  return bot.recordings?.[0]?.media_shortcuts?.video_mixed?.data?.download_url ?? undefined;
}

/**
 * Verifica la firma de un webhook de Recall.ai — entregado vía Svix, mismo
 * esquema documentado en docs.recall.ai/docs/authenticating-requests-from-recallai:
 * headers `Webhook-Id` / `Webhook-Timestamp` / `Webhook-Signature` (formato
 * "v1,<base64>"), secreto con prefijo "whsec_" (el resto es base64 de la
 * llave real), HMAC-SHA256 sobre "{id}.{timestamp}.{rawBody}". Necesita el
 * body CRUDO — por eso el webhook vive en su propia sub-app Hono, igual que
 * server/webhooks/mux.ts.
 */
export function verifyRecallWebhookSignature(
  rawBody: string,
  webhookId: string | undefined,
  webhookTimestamp: string | undefined,
  webhookSignature: string | undefined,
): boolean {
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;
  const secret = requireEnv('RECALL_WEBHOOK_SECRET');
  if (!secret.startsWith('whsec_')) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');

  const candidates = webhookSignature.split(' ').map(part => part.split(',')[1]).filter(Boolean);
  return candidates.some(candidate => {
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
