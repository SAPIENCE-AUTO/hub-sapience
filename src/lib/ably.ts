// Ably realtime helper — publish events from backend endpoints
// Uses REST API, no SDK dependency needed

/**
 * Convert an email to a safe Ably channel name for user-specific notifications.
 * e.g. "juan@empresa.com" → "user:juan_empresa_com"
 */
export function safeUserChannel(email: string): string {
  return 'user:' + email.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

const ABLY_REST_URL = 'https://rest.ably.io';

export async function publishEvent(channel: string, event: string, data: unknown): Promise<void> {
  const key = process.env.ZITE_ABLY_API_KEY?.trim();
  if (!key) {
    console.warn('[ably] No ZITE_ABLY_API_KEY configured, skipping publish');
    return;
  }

  const url = `${ABLY_REST_URL}/channels/${encodeURIComponent(channel)}/messages`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(key).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: event, data: JSON.stringify(data) }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[ably] publish failed (${resp.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[ably] publish error:', (err as Error).message);
  }
}

/**
 * Get the Ably subscribe-only key prefix for frontend SSE connections.
 * This extracts appId.keyId from the full key (appId.keyId:secret)
 * and returns the full key — but for SSE the frontend needs the full key.
 * Instead, we use Ably token auth: generate a short-lived token with subscribe-only capability.
 */
export async function createSubscribeToken(channels: string[]): Promise<{ token: string; expires: number } | null> {
  const key = process.env.ZITE_ABLY_API_KEY?.trim();
  if (!key) return null;

  const [keyId] = key.split(':');
  const keySecret = key.split(':')[1];
  if (!keyId || !keySecret) return null;

  // Build capability: subscribe-only for requested channels
  const capability: Record<string, string[]> = {};
  for (const ch of channels) {
    capability[ch] = ['subscribe'];
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = 3600; // 1 hour

  // Request a token from Ably
  const url = `https://rest.ably.io/keys/${keyId}/requestToken`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(key).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyName: keyId,
        ttl: ttl * 1000, // Ably expects milliseconds
        capability: JSON.stringify(capability),
        timestamp: now * 1000,
      }),
    });
    if (!resp.ok) {
      console.error(`[ably] token request failed (${resp.status})`);
      return null;
    }
    const data = await resp.json();
    return {
      token: data.token,
      expires: now + ttl,
    };
  } catch (err) {
    console.error('[ably] token error:', (err as Error).message);
    return null;
  }
}
