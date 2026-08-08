/**
 * Proveedor de tokens para Microsoft Graph.
 *
 * Reemplaza lo que Zite inyectaba en `ZITE_OUTLOOK_ACCESS_TOKEN` y
 * `ZITE_MICROSOFTTEAMS_ACCESS_TOKEN`. Usa el flujo de credenciales de cliente
 * (app-only): la app se autentica como ella misma, sin usuario, sin refresh
 * tokens y sin pantalla de login. Es el adecuado para un backend.
 *
 * Variables de entorno necesarias:
 *   MS_TENANT_ID       — el "Directory (tenant) ID" del registro en Azure
 *   MS_CLIENT_ID       — el "Application (client) ID"
 *   MS_CLIENT_SECRET   — el secreto que generaste (ojo: caduca)
 *   MS_SEND_AS_EMAIL   — buzón desde el que se envían las OCs y comprobantes
 *
 * El token vive una hora. Aquí se cachea en memoria y se renueva solo,
 * con un minuto de margen para no usar uno que expire a medio vuelo.
 */

interface CachedToken { value: string; expiresAt: number }

let cache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

const MARGIN_MS = 60_000;

export class GraphAuthError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GraphAuthError(`Falta la variable de entorno ${name}`);
  return v;
}

/** Devuelve un token válido, reutilizando el cacheado mientras sirva. */
export async function getGraphToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt - MARGIN_MS) return cache.value;

  // Si dos peticiones piden token a la vez, solo una va a Microsoft.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const tenant = requireEnv('MS_TENANT_ID');
    const body = new URLSearchParams({
      client_id: requireEnv('MS_CLIENT_ID'),
      client_secret: requireEnv('MS_CLIENT_SECRET'),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new GraphAuthError(`No se pudo obtener token de Graph (${res.status}): ${detail}`);
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

/**
 * Base de las rutas que antes eran `/me`.
 *
 * Con credenciales de aplicación no existe "yo": hay que decir sobre qué buzón
 * se actúa. Esto reemplaza el `/v1.0/me` de `syncOutlookInvite` y los
 * `/v1.0/me/sendMail` de los cuatro endpoints de correo.
 */
export function graphMailboxBase(email = process.env.MS_SEND_AS_EMAIL): string {
  if (!email) throw new GraphAuthError('Falta MS_SEND_AS_EMAIL');
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`;
}

/**
 * Envoltura de fetch que añade el token y traduce los errores de Graph
 * a algo legible. Los endpoints pueden usar esto en lugar de armar headers.
 */
export async function graphFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': (init.headers as Record<string, string>)?.['Content-Type'] ?? 'application/json',
    },
  });

  // 401 con token recién emitido suele significar permisos sin consentimiento
  // de administrador, no token vencido. Vale distinguirlo en el mensaje.
  if (res.status === 401) {
    cache = null;
    const detail = await res.clone().text().catch(() => '');
    throw new GraphAuthError(
      `Graph rechazó el token (401). Revisa que los permisos de aplicación tengan ` +
      `consentimiento de administrador otorgado. Detalle: ${detail.slice(0, 300)}`,
    );
  }

  return res;
}

/** Para pruebas: olvida el token cacheado. */
export function resetGraphTokenCache(): void {
  cache = null;
}
