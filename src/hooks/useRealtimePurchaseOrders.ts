import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken } from 'zite-endpoints-sdk';

type UseRealtimePurchaseOrdersOptions = {
  userEmail: string;
  onChanged: () => void;
  enabled?: boolean;
};

export type RealtimePOStatus = 'connecting' | 'connected' | 'error' | 'disabled';

const CHANNEL = 'purchases:global';

export function useRealtimePurchaseOrders({
  userEmail,
  onChanged,
  enabled = true,
}: UseRealtimePurchaseOrdersOptions): { status: RealtimePOStatus } {
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const [status, setStatus] = useState<RealtimePOStatus>('disabled');
  const eventSourceRef  = useRef<EventSource | null>(null);
  const tokenRef        = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      setStatus('disabled');
      return;
    }

    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await getAblyToken({ channels: [CHANNEL] });
          if (res.token && res.expires) {
            tokenRef.current = { token: res.token, expires: res.expires };
          } else {
            console.warn('[ably][purchases] Token failed:', res.error ?? 'no token');
            setStatus('error');
            if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10000);
            return;
          }
        } catch (err) {
          console.warn('[ably][purchases] Token error:', (err as Error).message);
          setStatus('error');
          if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10000);
          return;
        }
      }

      if (cancelled) return;

      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(CHANNEL)}&accessToken=${encodeURIComponent(tokenRef.current!.token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) setStatus('connected');
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.name !== 'po.changed') return;

          const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;

          // Skip own events — the local UI already updates after each action
          if (data?.senderEmail && data.senderEmail === userEmail) return;

          onChangedRef.current();
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        if (!cancelled) {
          setStatus('error');
          es.close();
          eventSourceRef.current = null;
          tokenRef.current = null;
          retryTimeoutRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Refresh token proactively every 50 minutes
    const tokenRefreshInterval = setInterval(() => {
      if (!cancelled && tokenRef.current) {
        const now = Math.floor(Date.now() / 1000);
        if (tokenRef.current.expires - now < 600) {
          cleanup();
          tokenRef.current = null;
          connect();
        }
      }
    }, 50 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(tokenRefreshInterval);
      cleanup();
      setStatus('disabled');
    };
  }, [enabled, userEmail, cleanup]);

  return { status };
}
