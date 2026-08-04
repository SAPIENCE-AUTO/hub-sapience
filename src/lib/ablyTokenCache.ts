import { getAblyToken } from 'zite-endpoints-sdk';

type CachedToken = { token: string; expires: number };

const tokenCache = new Map<string, CachedToken>();
const inflightRequests = new Map<string, Promise<CachedToken | null>>();

/**
 * Get an Ably token for a channel, reusing cached tokens and deduplicating
 * in-flight requests. Two hooks subscribing to the same channel at the same
 * time will share a single getAblyToken call instead of firing two requests.
 */
export async function getCachedAblyToken(channel: string): Promise<CachedToken | null> {
  // Check cache — token is valid if it expires in more than 5 minutes
  const cached = tokenCache.get(channel);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - now > 300) {
    return cached;
  }

  // Deduplicate: if a request is already in-flight for this channel, reuse it
  const existing = inflightRequests.get(channel);
  if (existing) {
    return existing;
  }

  // Make the request and cache the result
  const promise = (async (): Promise<CachedToken | null> => {
    try {
      const res = await getAblyToken({ channels: [channel] });
      if (res.token && res.expires) {
        const result = { token: res.token, expires: res.expires };
        tokenCache.set(channel, result);
        return result;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflightRequests.delete(channel);
    }
  })();

  inflightRequests.set(channel, promise);
  return promise;
}

/** Invalidate a cached token (e.g. after SSE error forces a reconnect) */
export function invalidateAblyToken(channel: string): void {
  tokenCache.delete(channel);
}
