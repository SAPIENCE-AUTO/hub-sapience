import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken, preworkGetAblyToken } from 'zite-endpoints-sdk';

export type RealtimePreworkStatus = 'connecting' | 'connected' | 'error' | 'disabled';

interface TokenResult { token?: string; expires?: number; channel?: string; error?: string }

/**
 * Base común a los dos hooks de abajo — mismo patrón EventSource/token de
 * useRealtimePurchaseOrders.ts (la convención del repo es un hook chico por
 * dominio, no reusar el hook "base" que en realidad es chat-specific).
 * Factorizado UNA vez aquí porque este archivo ya necesita la misma
 * mecánica dos veces (moderador y participante), no para generalizar entre
 * archivos.
 */
function useAblySSE(opts: {
  enabled: boolean;
  fetchToken: () => Promise<TokenResult>;
  onEvent: (name: string, data: unknown) => void;
}): { status: RealtimePreworkStatus } {
  const { enabled, fetchToken, onEvent } = opts;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const fetchTokenRef = useRef(fetchToken);
  fetchTokenRef.current = fetchToken;

  const [status, setStatus] = useState<RealtimePreworkStatus>('disabled');
  const eventSourceRef = useRef<EventSource | null>(null);
  const tokenRef = useRef<{ token: string; expires: number; channel: string } | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
  }, []);

  useEffect(() => {
    if (!enabled) { cleanup(); setStatus('disabled'); return; }

    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await fetchTokenRef.current();
          if (res.token && res.expires && res.channel) {
            tokenRef.current = { token: res.token, expires: res.expires, channel: res.channel };
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

      const { token, channel } = tokenRef.current;
      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(channel)}&accessToken=${encodeURIComponent(token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => { if (!cancelled) setStatus('connected'); };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
          onEventRef.current(parsed.name, data);
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
  }, [enabled, cleanup]);

  return { status };
}

/** Panel del moderador: se refresca solo cuando llega una entrega nueva a ESTE estudio. */
export function useRealtimePreworkModerador({
  estudioId, onRespuestaNueva, enabled = true,
}: { estudioId?: string; onRespuestaNueva: () => void; enabled?: boolean }): { status: RealtimePreworkStatus } {
  const channel = estudioId ? `prework:estudio:${estudioId}` : '';
  return useAblySSE({
    enabled: enabled && !!estudioId,
    fetchToken: async () => {
      const res = await getAblyToken({ channels: [channel] });
      return { ...res, channel };
    },
    onEvent: (name) => { if (name === 'respuesta.created') onRespuestaNueva(); },
  });
}

/** Portal del participante: nueva misión (ya lanzada) o follow-up nuevo. */
export function useRealtimePreworkParticipante({
  token, onMisionNueva, onSeguimientoNuevo, enabled = true,
}: {
  token?: string | null;
  onMisionNueva: () => void;
  onSeguimientoNuevo: () => void;
  enabled?: boolean;
}): { status: RealtimePreworkStatus } {
  return useAblySSE({
    enabled: enabled && !!token,
    fetchToken: async () => preworkGetAblyToken({ token }),
    onEvent: (name) => {
      if (name === 'mision.created') onMisionNueva();
      if (name === 'seguimiento.created') onSeguimientoNuevo();
    },
  });
}
