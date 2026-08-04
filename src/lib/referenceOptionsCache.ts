/**
 * Frontend singleton cache for getReferenceOptions.
 *
 * Problem: ChatPage, ReferencePicker and EntityMentionMenu all mount around
 * the same time and each fire getReferenceOptions({}) independently, causing
 * "Too many requests" rate-limit errors.
 *
 * Solution: share a single in-flight Promise so concurrent callers wait for
 * the same network request, and cache the result for 10 minutes so re-mounts
 * don't re-fetch.
 */
import { getReferenceOptions, GetReferenceOptionsOutputType } from 'zite-endpoints-sdk';

type ReferenceData = GetReferenceOptionsOutputType;

let cachedData: ReferenceData | null = null;
let cacheExpiresAt = 0;
let inflight: Promise<ReferenceData> | null = null;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getReferenceOptionsCached(): Promise<ReferenceData> {
  const now = Date.now();

  // Return cached data if still fresh
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }

  // Deduplicate concurrent callers — all share the same in-flight promise
  if (inflight) {
    return inflight;
  }

  inflight = getReferenceOptions({})
    .then(data => {
      cachedData = data;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      inflight = null;
      return data;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });

  return inflight;
}

/** Call this after creating/editing data that getReferenceOptions reflects (tasks, events, etc.) */
export function invalidateReferenceOptionsCache() {
  cachedData = null;
  cacheExpiresAt = 0;
}
