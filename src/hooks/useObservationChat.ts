import { useEffect, useRef, useCallback, useState } from 'react';

export type ObservationChatMessage = {
  id: string;
  nombre?: string;
  esProductor: boolean;
  body: string;
  createdAt: string;
};

type TokenResult = { token: string; expires: number; channel: string } | null;

type UseObservationChatOptions = {
  enabled?: boolean;
  // Cambia cuando cambia la identidad de quien escucha (observerId o
  // calendarEventId) — fuerza una reconexión limpia en vez de reusar un
  // EventSource que quedó apuntando al canal de otra sesión/observador.
  dependencyKey: string;
  getToken: () => Promise<TokenResult>;
  onMessage: (msg: ObservationChatMessage) => void;
  onDeleted?: (messageId: string) => void;
  onSessionState?: (estado: string) => void;
};

/**
 * Duplicado del patrón SSE-sobre-Ably de useRealtimeUserNotifications.ts —
 * no se comparte código de conexión entre el chat de usuarios del Hub y el
 * de la Sala de observación porque los canales, los payloads y quién puede
 * pedir el token son distintos (uno autenticado por sesión de Supabase, el
 * otro público por slug+observerId).
 */
export function useObservationChat({
  enabled = true, dependencyKey, getToken, onMessage, onDeleted, onSessionState,
}: UseObservationChatOptions): { status: 'connecting' | 'connected' | 'disconnected' } {
  const onMessageRef = useRef(onMessage);
  const onDeletedRef = useRef(onDeleted);
  const onSessionStateRef = useRef(onSessionState);
  const getTokenRef = useRef(getToken);
  onMessageRef.current = onMessage;
  onDeletedRef.current = onDeleted;
  onSessionStateRef.current = onSessionState;
  getTokenRef.current = getToken;

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const tokenRef = useRef<TokenResult>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
  }, []);

  useEffect(() => {
    if (!enabled || !dependencyKey) { cleanup(); return; }
    let cancelled = false;

    const connect = async () => {
      if (!cancelled) setStatus('connecting');

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await getTokenRef.current();
          if (res?.token) {
            tokenRef.current = res;
          } else {
            if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10_000);
            return;
          }
        } catch {
          if (!cancelled) retryTimeoutRef.current = setTimeout(connect, 10_000);
          return;
        }
      }
      if (cancelled) return;

      const { token, channel } = tokenRef.current!;
      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(channel)}&accessToken=${encodeURIComponent(token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => { if (!cancelled) setStatus('connected'); };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
          if (parsed.name === 'chat.message' && data) onMessageRef.current(data);
          else if (parsed.name === 'chat.deleted' && data?.id) onDeletedRef.current?.(data.id);
          else if (parsed.name === 'session.state' && data?.estado) onSessionStateRef.current?.(data.estado);
        } catch {
          // evento malformado, se ignora
        }
      };

      es.onerror = () => {
        if (!cancelled) {
          setStatus('disconnected');
          es.close();
          eventSourceRef.current = null;
          tokenRef.current = null; // fuerza pedir un token nuevo en el reintento
          retryTimeoutRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Refresca el token antes de que expire (mismo margen que useRealtimeUserNotifications).
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
    };
  }, [enabled, dependencyKey, cleanup]);

  return { status };
}
