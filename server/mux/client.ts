/**
 * Cliente de Mux para la Sala de observación.
 *
 * A diferencia de Microsoft Graph (server/microsoft/graph.ts), Mux usa Basic
 * Auth con un Access Token fijo (Token ID + Token Secret) — no hay OAuth2 ni
 * refresh, así que no hace falta cache de token en memoria.
 *
 * Variables de entorno necesarias:
 *   ZITE_MUX_TOKEN_ID      — Token ID del Access Token creado en el dashboard de Mux
 *   ZITE_MUX_TOKEN_SECRET  — Token Secret del mismo Access Token
 *   ZITE_MUX_WEBHOOK_SECRET — Signing secret del endpoint de webhooks configurado en Mux
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const MUX_API_BASE = 'https://api.mux.com';

export class MuxAuthError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new MuxAuthError(`Falta la variable de entorno ${name}`);
  return v;
}

function authHeader(): string {
  const tokenId = requireEnv('ZITE_MUX_TOKEN_ID');
  const tokenSecret = requireEnv('ZITE_MUX_TOKEN_SECRET');
  return `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`;
}

/** Envoltura de fetch que añade Basic Auth y traduce errores de Mux a algo legible. */
export async function muxFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${MUX_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: authHeader(),
      'Content-Type': (init.headers as Record<string, string>)?.['Content-Type'] ?? 'application/json',
    },
  });
  if (!res.ok) {
    const detail = await res.clone().text().catch(() => '');
    throw new MuxAuthError(`Mux respondió ${res.status} en ${path}: ${detail.slice(0, 300)}`);
  }
  return res;
}

export interface MuxLiveStream {
  id: string;
  stream_key: string;
  playback_ids: Array<{ id: string; policy: string }>;
}

/**
 * Un live stream por sesión (nunca compartido — un live stream de Mux acepta
 * una sola conexión RTMP a la vez, y hay sesiones simultáneas). Sin marca de
 * agua ni firma en el playback: coherente con el link abierto de la sala.
 */
export async function createLiveStream(): Promise<MuxLiveStream> {
  const res = await muxFetch('/video/v1/live-streams', {
    method: 'POST',
    body: JSON.stringify({
      playback_policy: ['public'],
      new_asset_settings: { playback_policy: ['public'] },
      latency_mode: 'low',
      reconnect_window: 60,
    }),
  });
  const { data } = (await res.json()) as { data: MuxLiveStream };
  return data;
}

/** Los assets grabados sobreviven al borrado del live stream — limpieza segura. */
export async function deleteLiveStream(liveStreamId: string): Promise<void> {
  await muxFetch(`/video/v1/live-streams/${encodeURIComponent(liveStreamId)}`, { method: 'DELETE' });
}

/**
 * Verifica la firma `Mux-Signature: t=<ts>,v1=<hmac>` de un webhook.
 * HMAC-SHA256 sobre `${timestamp}.${rawBody}` con el signing secret — el
 * mismo esquema que Stripe. Necesita el body CRUDO (antes de cualquier
 * parseo JSON), por eso el webhook vive en su propia sub-app Hono en vez de
 * pasar por el dispatcher genérico de server/index.ts.
 */
export function verifyMuxWebhookSignature(rawBody: string, signatureHeader: string | undefined, toleranceSeconds = 300): boolean {
  if (!signatureHeader) return false;
  const secret = requireEnv('ZITE_MUX_WEBHOOK_SECRET');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()];
    }),
  );
  const timestamp = parts['t'];
  const expectedHash = parts['v1'];
  if (!timestamp || !expectedHash) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const computedHash = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(computedHash);
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
