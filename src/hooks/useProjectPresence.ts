import { useEffect, useRef, useCallback, useState } from 'react';
import { updatePresence, getPresence, publishPresenceEvent } from 'zite-endpoints-sdk';
import { getCachedAblyToken, invalidateAblyToken } from '../lib/ablyTokenCache';

export type PresenceMember = {
  email: string;
  name?: string;
  profilePhoto?: string;
  pageName?: string;
};

type UseProjectPresenceOptions = {
  projectCode: string | null;
  pageName: string;
  enabled: boolean;
  user?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    profilePhoto?: string;
  };
};

export function useProjectPresence({
  projectCode,
  pageName,
  enabled,
  user,
}: UseProjectPresenceOptions) {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  const lastPublishRef    = useRef<number>(0);
  const eventSourceRef    = useRef<EventSource | null>(null);
  const tokenRef          = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cache name+photo from real-time events so polls can enrich presence
  const profileCacheRef   = useRef<Map<string, { name?: string; profilePhoto?: string }>>(new Map());

  const myEmail      = user?.email;
  const name         = user ? (`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email) : undefined;
  const profilePhoto = user?.profilePhoto;

  const sseCleanup = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
  }, []);

  useEffect(() => {
    if (!enabled || !projectCode || !myEmail) {
      sseCleanup();
      setMembers([]);
      return;
    }

    const activeChannel = `project:${projectCode}:${pageName}`;
    const ablyChannel   = `board:${projectCode}`;
    let cancelled = false;

    // ── Publish own presence (updatePresence + publishPresenceEvent) ──────────
    const publishPresence = async () => {
      const now = Date.now();
      const isFirst = lastPublishRef.current === 0;
      if (!isFirst && now - lastPublishRef.current < 60000) return;

      try { await updatePresence({ activeChannel }); } catch { /* silent */ }
      try {
        await publishPresenceEvent({
          projectCode,
          pageName,
          activeChannel,
          name: name || undefined,
          profilePhoto: profilePhoto || undefined,
        });
        lastPublishRef.current = Date.now();
      } catch (err) {
        console.warn('[presence] publishPresenceEvent failed (rate limit?)', err);
      }
    };

    // ── Fetch full presence snapshot from DB and merge with profile cache ─────
    const fetchAndSetPresence = async () => {
      try {
        const data = await getPresence({});
        const prefix   = `project:${projectCode}:`;
        const filtered = data.users.filter(u => u.email !== myEmail && u.activeChannel?.startsWith(prefix));
        setMembers(filtered.map(u => {
          const cached   = profileCacheRef.current.get(u.email);
          const pg       = (u.activeChannel ?? '').slice(prefix.length);
          // Prefer SSE cache (most recent), fall back to DB fields from poll
          const fullName = cached?.name
            ?? ([u.firstName, u.lastName].filter(Boolean).join(' ').trim() || undefined);
          const photo    = cached?.profilePhoto ?? u.profilePhoto ?? undefined;
          return { email: u.email, name: fullName, profilePhoto: photo, pageName: pg };
        }));
      } catch { /* silent */ }
    };

    // ── SSE connection — shares Ably token with useRealtimeBoardEvents ────────
    // Both hooks connect to the same board:{projectCode} channel. Using the
    // shared token cache ensures only one getAblyToken request fires even if
    // both hooks connect simultaneously.
    const connect = async () => {
      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        const tokenResult = await getCachedAblyToken(ablyChannel);
        if (tokenResult) {
          tokenRef.current = tokenResult;
        } else {
          if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10000);
          return;
        }
      }
      if (cancelled) return;

      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(ablyChannel)}&accessToken=${encodeURIComponent(tokenRef.current!.token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.name !== 'user.presence') return;

          const data: {
            email: string;
            name?: string;
            profilePhoto?: string;
            pageName?: string;
            projectCode?: string;
            activeChannel?: string;
          } = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;

          if (!data.email || data.email === myEmail) return;
          if (data.projectCode !== projectCode) return;

          // Cache profile info for future poll merges
          profileCacheRef.current.set(data.email, { name: data.name, profilePhoto: data.profilePhoto });

          setMembers(prev => {
            const others = prev.filter(m => m.email !== data.email);
            return [...others, {
              email: data.email,
              name: data.name,
              profilePhoto: data.profilePhoto,
              pageName: data.pageName,
            }];
          });
        } catch { /* ignore malformed events */ }
      };

      es.onerror = () => {
        if (!cancelled) {
          es.close();
          eventSourceRef.current = null;
          // Invalidate shared cache so next connect fetches a fresh token
          invalidateAblyToken(ablyChannel);
          tokenRef.current = null;
          retryTimeoutRef.current = setTimeout(connect, 3000);
        }
      };
    };

    // Initial publish + fetch, then connect SSE
    publishPresence();
    fetchAndSetPresence();
    connect();

    // Heartbeat every 120s to keep presence alive
    heartbeatRef.current = setInterval(() => { if (document.visibilityState === 'visible') publishPresence(); }, 300000);

    // Full state poll every 3 min as fallback (SSE handles real-time updates)
    pollRef.current = setInterval(() => { if (document.visibilityState === 'visible') fetchAndSetPresence(); }, 600000);

    return () => {
      cancelled = true;
      sseCleanup();
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (pollRef.current)      { clearInterval(pollRef.current);      pollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCode, pageName, enabled, myEmail, name, profilePhoto]);

  return { members, count: members.length };
}
