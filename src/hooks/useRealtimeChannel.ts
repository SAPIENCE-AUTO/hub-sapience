import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken } from 'zite-endpoints-sdk';

type RealtimeMessage = {
  id: string;
  channel?: string;
  content?: string;
  senderName?: string;
  senderEmail?: string;
  sentAt?: string;
  parentMessageId?: string;
  reactions?: string;
  pinned?: boolean;
  attachments?: string;
};

type ReactionPayload = { messageId: string; channel: string; reactions: string };
type PinnedPayload   = { messageId: string; channel: string; pinned: boolean };
type PollPayload     = { messageId: string; channel: string; content: string };
export type TypingPayload = { channel: string; userEmail: string; userName: string; sentAt: string };

type UseRealtimeChannelOptions = {
  channel: string;
  onMessageCreated?: (msg: RealtimeMessage) => void;
  onReactionUpdated?: (payload: ReactionPayload) => void;
  onMessagePinned?:   (payload: PinnedPayload)   => void;
  onPollUpdated?:     (payload: PollPayload)      => void;
  onTyping?:          (payload: TypingPayload)    => void;
  enabled?: boolean;
};

export type RealtimeStatus = 'connecting' | 'connected' | 'error' | 'disabled';

export function useRealtimeChannel({
  channel,
  onMessageCreated,
  onReactionUpdated,
  onMessagePinned,
  onPollUpdated,
  onTyping,
  enabled = true,
}: UseRealtimeChannelOptions): { status: RealtimeStatus } {
  const callbackRef  = useRef(onMessageCreated);
  const reactionRef  = useRef(onReactionUpdated);
  const pinnedRef    = useRef(onMessagePinned);
  const pollRef      = useRef(onPollUpdated);
  const typingRef    = useRef(onTyping);

  callbackRef.current  = onMessageCreated;
  reactionRef.current  = onReactionUpdated;
  pinnedRef.current    = onMessagePinned;
  pollRef.current      = onPollUpdated;
  typingRef.current    = onTyping;

  const [status, setStatus] = useState<RealtimeStatus>('disabled');
  const eventSourceRef   = useRef<EventSource | null>(null);
  const tokenRef         = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!enabled || !channel) {
      cleanup();
      setStatus('disabled');
      return;
    }

    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');
      console.log('[ably][sse connecting]', { channel, ablyChannel: `chat:${channel}` });

      // Get or refresh token
      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const ablyChannel = `chat:${channel}`;
          const res = await getAblyToken({ channels: [ablyChannel] });
          if (res.token && res.expires) {
            tokenRef.current = { token: res.token, expires: res.expires };
            console.log('[ably][token ok]', { channel, expiresIn: res.expires - now });
          } else {
            console.warn('[ably][token failed]', { channel, error: res.error ?? 'no token returned' });
            setStatus('error');
            if (!cancelled) {
              retryTimeoutRef.current = setTimeout(connect, 10000);
            }
            return;
          }
        } catch (err) {
          console.warn('[ably][token error]', { channel, error: (err as Error).message });
          setStatus('error');
          if (!cancelled) {
            retryTimeoutRef.current = setTimeout(connect, 10000);
          }
          return;
        }
      }

      if (cancelled) return;

      const ablyChannel = `chat:${channel}`;
      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(ablyChannel)}&accessToken=${encodeURIComponent(tokenRef.current!.token)}&v=1.2`;

      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) {
          setStatus('connected');
          console.log('[ably][sse connected] ✓', { channel, ablyChannel });
        }
      };

      es.onmessage = (event) => {
        console.log('[ably][raw event]', { channel, data: event.data?.slice?.(0, 300) });
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.name === 'message.created' && parsed.data) {
            const msg: RealtimeMessage = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            console.log('[ably][event received]', { name: parsed.name, id: msg.id, channel: msg.channel });
            callbackRef.current?.(msg);
          }

          if (parsed.name === 'reaction.updated' && parsed.data) {
            const payload: ReactionPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            console.log('[ably][received reaction.updated]', payload);
            reactionRef.current?.(payload);
          }

          if (parsed.name === 'message.pinned' && parsed.data) {
            const payload: PinnedPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            console.log('[ably][received message.pinned]', payload);
            pinnedRef.current?.(payload);
          }

          if (parsed.name === 'poll.updated' && parsed.data) {
            const payload: PollPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            console.log('[ably][received poll.updated]', payload);
            pollRef.current?.(payload);
          }

          if (parsed.name === 'typing' && parsed.data) {
            const payload: TypingPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            typingRef.current?.(payload);
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        console.warn('[ably][sse error]', { channel, ablyChannel, readyState: es.readyState });
        if (!cancelled) {
          setStatus('error');
          es.close();
          eventSourceRef.current = null;
          tokenRef.current = null; // Force re-fetch
          retryTimeoutRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Refresh token before expiry (every 50 minutes)
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
      console.log('[ably][sse disconnected]', { channel });
    };
  }, [channel, enabled, cleanup]);

  return { status };
}
