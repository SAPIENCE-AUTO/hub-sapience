import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken } from 'zite-endpoints-sdk';

export type RealtimeEjesStatus = 'connecting' | 'connected' | 'error' | 'disabled';

/**
 * Mismo patrón que el `useAblySSE` interno de `useRealtimePrework.ts`
 * (token → SSE de Ably → reconexión) — se duplica esa pieza chica en vez de
 * generalizar `useRealtimeChannel.ts` (chat-specific), siguiendo el mismo
 * criterio que Prework ya sentó. A diferencia de Prework (que necesitó un
 * endpoint público de token porque su participante no tiene sesión de Hub),
 * aquí solo el FACILITADOR necesita tiempo real — ya está autenticado, así
 * que reusa `getAblyToken` tal cual (con el prefijo `ejes:` ya agregado a su
 * allowlist) en vez de crear un endpoint público nuevo.
 */
export function useRealtimeEjes({
  tableroId, onEvaluacionNueva, enabled = true,
}: { tableroId?: string; onEvaluacionNueva: () => void; enabled?: boolean }): { status: RealtimeEjesStatus } {
  const channel = tableroId ? `ejes:tablero:${tableroId}` : '';
  const onEvaluacionNuevaRef = useRef(onEvaluacionNueva);
  onEvaluacionNuevaRef.current = onEvaluacionNueva;

  const [status, setStatus] = useState<RealtimeEjesStatus>('disabled');
  const eventSourceRef = useRef<EventSource | null>(null);
  const tokenRef = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
  }, []);

  useEffect(() => {
    const isEnabled = enabled && !!tableroId;
    if (!isEnabled) { cleanup(); setStatus('disabled'); return; }

    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await getAblyToken({ channels: [channel] });
          if (res.token && res.expires) {
            tokenRef.current = { token: res.token, expires: res.expires };
          } else {
            setStatus('error');
            if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10000);
            return;
          }
        } catch {
          setStatus('error');
          if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10000);
          return;
        }
      }
      if (cancelled) return;

      const { token } = tokenRef.current;
      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(channel)}&accessToken=${encodeURIComponent(token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => { if (!cancelled) setStatus('connected'); };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.name === 'evaluacion.created') onEvaluacionNuevaRef.current();
        } catch { /* evento malformado, se ignora */ }
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

    const tokenRefreshInterval = setInterval(() => {
      if (!cancelled && tokenRef.current) {
        const now = Math.floor(Date.now() / 1000);
        if (tokenRef.current.expires - now < 600) { cleanup(); tokenRef.current = null; connect(); }
      }
    }, 50 * 60 * 1000);

    return () => { cancelled = true; clearInterval(tokenRefreshInterval); cleanup(); setStatus('disabled'); };
  }, [enabled, tableroId, channel, cleanup]);

  return { status };
}
