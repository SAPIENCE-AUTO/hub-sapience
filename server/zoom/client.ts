/**
 * Cliente de Zoom (Server-to-Server OAuth) para crear el meeting de la Sala
 * de observación y apuntarlo al live stream de Mux, todo desde el botón
 * "Crear stream" — sin tocar Zoom ni StreamYard a mano.
 *
 * Mismo patrón que server/microsoft/graph.ts (cache de token en memoria +
 * requireEnv + fetch wrapper), pero el grant de Zoom es `account_credentials`
 * en vez de `client_credentials`, y no necesita refresh manual porque el
 * token dura 1h y aquí igual se cachea con margen.
 *
 * Variables de entorno necesarias:
 *   ZITE_ZOOM_ACCOUNT_ID     — Account ID de la app Server-to-Server OAuth
 *   ZITE_ZOOM_CLIENT_ID      — Client ID de esa app
 *   ZITE_ZOOM_CLIENT_SECRET  — Client Secret de esa app
 *   ZITE_ZOOM_HOST_EMAILS    — lista separada por comas de correos con licencia
 *                              de Zoom disponibles para hostear meetings. Hay
 *                              sesiones simultáneas y una cuenta de Zoom no
 *                              puede hostear dos a la vez — quién de la lista
 *                              se usa para cada sesión lo decide
 *                              src/serverUtils/provisionObservationSession.ts
 *                              (el mismo problema que resuelve un live stream
 *                              de Mux por sesión, aplicado a las cuentas de Zoom).
 */

interface CachedToken { value: string; expiresAt: number }

let cache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

const MARGIN_MS = 60_000;

export class ZoomAuthError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new ZoomAuthError(`Falta la variable de entorno ${name}`);
  return v;
}

async function getZoomToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt - MARGIN_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const accountId = requireEnv('ZITE_ZOOM_ACCOUNT_ID');
    const clientId = requireEnv('ZITE_ZOOM_CLIENT_ID');
    const clientSecret = requireEnv('ZITE_ZOOM_CLIENT_SECRET');
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ZoomAuthError(`No se pudo obtener token de Zoom (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return cache.value;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function zoomFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getZoomToken();
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) {
    cache = null;
    const detail = await res.clone().text().catch(() => '');
    throw new ZoomAuthError(`Zoom rechazó el token (401): ${detail.slice(0, 300)}`);
  }
  return res;
}

export interface ZoomMeeting { id: number; join_url: string; start_url: string }

/**
 * Meeting programado a la fecha/hora real del evento de calendario, a nombre
 * del host que le toque (ver arriba). `alternativeHosts` — el resto del pool
 * de ZITE_ZOOM_HOST_EMAILS — deja que cualquiera de ellos arranque el
 * meeting con controles de host, sin depender de que el host original
 * (elegido solo por disponibilidad de horario) sea quien esté presente.
 * Zoom exige que sean usuarios con licencia de la MISMA cuenta — no cualquier
 * persona de la organización.
 */
export async function createZoomMeeting(params: {
  hostEmail: string; alternativeHosts?: string[]; topic: string; startTimeIso: string; durationMinutes: number;
}): Promise<ZoomMeeting> {
  const res = await zoomFetch(`/users/${encodeURIComponent(params.hostEmail)}/meetings`, {
    method: 'POST',
    body: JSON.stringify({
      topic: params.topic,
      type: 2, // scheduled
      start_time: params.startTimeIso,
      duration: params.durationMinutes,
      settings: {
        join_before_host: true,
        waiting_room: false,
        ...(params.alternativeHosts?.length ? { alternative_hosts: params.alternativeHosts.join(',') } : {}),
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ZoomAuthError(`Zoom respondió ${res.status} creando el meeting: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as ZoomMeeting;
  return data;
}

/** Apunta el meeting al live stream de Mux — así el host solo le da "Live" adentro de Zoom. */
export async function setZoomLiveStream(meetingId: number, params: { streamUrl: string; streamKey: string; pageUrl?: string }): Promise<void> {
  const res = await zoomFetch(`/meetings/${meetingId}/livestream`, {
    method: 'PATCH',
    body: JSON.stringify({
      stream_url: params.streamUrl,
      stream_key: params.streamKey,
      page_url: params.pageUrl,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ZoomAuthError(`Zoom respondió ${res.status} configurando el live stream: ${detail.slice(0, 300)}`);
  }
}
