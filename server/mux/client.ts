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

export interface MuxAsset {
  id: string;
  status: string;
  playback_ids?: Array<{ id: string; policy: string }>;
}

/**
 * Minutas / notetaker (sep 2026): ingesta un MP4 ya grabado (la URL
 * pre-firmada que entrega Recall.ai) para que vida permanentemente en Mux
 * con reproductor real — a diferencia de createLiveStream, aquí no hay RTMP
 * ni sesión en vivo, es "toma este archivo y procésalo". `public` porque
 * hoy el player (mux-player) no maneja tokens firmados; si más adelante
 * hace falta restringir el acceso a las minutas, esto pasa a `signed`.
 */
export async function createAssetFromUrl(sourceUrl: string): Promise<MuxAsset> {
  const res = await muxFetch('/video/v1/assets', {
    method: 'POST',
    body: JSON.stringify({
      input: [{ url: sourceUrl }],
      playback_policy: ['public'],
    }),
  });
  const { data } = (await res.json()) as { data: MuxAsset };
  return data;
}

export async function getAsset(assetId: string): Promise<MuxAsset> {
  const res = await muxFetch(`/video/v1/assets/${encodeURIComponent(assetId)}`);
  const { data } = (await res.json()) as { data: MuxAsset };
  return data;
}

export interface MuxDirectUpload {
  id: string;
  url: string;
}

/**
 * Minutas / notetaker (sep 2026): subida manual de audio/video grabado por
 * otra vía (Sergio: "no quiero subir el audio o video a supabase... debería
 * subir a mux"). Direct Upload le da al navegador una URL firmada para
 * mandar el archivo DIRECTO a Mux — nunca pasa por nuestro servidor ni por
 * el bucket de Supabase Storage, así que ni el body limit de server/upload.ts
 * (50MB) ni el fileSizeLimit del bucket aplican aquí.
 *
 * Sin static_renditions a propósito — ver el mismo comentario real en
 * Sharpli (streamvault/src/api/getMuxUploadUrl.ts): pedir un rendition
 * estático retrasa el evento "ready" hasta que ESE render también termina,
 * que es justo lo que hacía tardar las minutas. La transcripción ya no
 * depende de Mux en absoluto — el navegador sube el mismo archivo en
 * paralelo a AssemblyAI vía el relay del servidor (server/assemblyRelay.ts),
 * igual que hace Sharpli.
 */
export async function createDirectUpload(corsOrigin: string): Promise<MuxDirectUpload> {
  const res = await muxFetch('/video/v1/uploads', {
    method: 'POST',
    body: JSON.stringify({
      cors_origin: corsOrigin,
      new_asset_settings: { playback_policies: ['public'] },
    }),
  });
  const { data } = (await res.json()) as { data: MuxDirectUpload };
  return data;
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
