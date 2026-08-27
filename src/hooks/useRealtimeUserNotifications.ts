import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken } from 'zite-endpoints-sdk';

// Duplicated from src/lib/ably.ts — cannot import backend code from frontend
export function safeUserChannel(email: string): string {
  return 'user:' + email.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

export type UserNotificationPayload = {
  channel: string;
  messageId?: string;
  senderName?: string;
  senderEmail?: string;
  hasMention: boolean;
  sentAt?: string;
  contentPreview?: string;
  isActiveChannel?: boolean;
};

export type ConversationCreatedPayload = {
  conversationId: string;
  conversationType: 'DM' | 'Group';
  conversationName: string;
  members: string[];
  createdBy: string;
  createdAt: string;
};

export type ConversationDeletedPayload = {
  conversationId: string;
};

export type ConversationRenamedPayload = {
  conversationId: string;
  conversationName: string;
};

export type ConversationMembersUpdatedPayload = {
  conversationId: string;
  members: string[];
};

type UseRealtimeUserNotificationsOptions = {
  userEmail: string;
  activeChannel: string;
  enabled?: boolean;
  onNewMessage: (payload: UserNotificationPayload) => void;
  onConversationCreated?: (payload: ConversationCreatedPayload) => void;
  onConversationDeleted?: (payload: ConversationDeletedPayload) => void;
  onConversationRenamed?: (payload: ConversationRenamedPayload) => void;
  onConversationMembersUpdated?: (payload: ConversationMembersUpdatedPayload) => void;
};

export function useRealtimeUserNotifications({
  userEmail,
  activeChannel,
  enabled = true,
  onNewMessage,
  onConversationCreated,
  onConversationDeleted,
  onConversationRenamed,
  onConversationMembersUpdated,
}: UseRealtimeUserNotificationsOptions): { status: 'connecting' | 'connected' | 'disconnected' } {
  // Use a ref for the callback so the SSE loop never goes stale without reconnecting
  const onNewMessageRef = useRef(onNewMessage);
  const onConversationCreatedRef = useRef(onConversationCreated);
  const onConversationDeletedRef = useRef(onConversationDeleted);
  const onConversationRenamedRef = useRef(onConversationRenamed);
  const onConversationMembersUpdatedRef = useRef(onConversationMembersUpdated);
  const activeChannelRef = useRef(activeChannel);
  onNewMessageRef.current = onNewMessage;
  onConversationCreatedRef.current = onConversationCreated;
  onConversationDeletedRef.current = onConversationDeleted;
  onConversationRenamedRef.current = onConversationRenamed;
  onConversationMembersUpdatedRef.current = onConversationMembersUpdated;
  activeChannelRef.current = activeChannel;

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  const tokenRef = useRef<{ token: string; expires: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
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
    if (!enabled || !userEmail) {
      cleanup();
      return;
    }

    const ablyChannel = safeUserChannel(userEmail);
    let cancelled = false;

    const connect = async () => {
      console.log('[ably][user-notify][connecting]', { ablyChannel });
      if (!cancelled) setStatus('connecting');

      // Get or refresh token
      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await getAblyToken({ channels: [ablyChannel] });
          if (res.token && res.expires) {
            tokenRef.current = { token: res.token, expires: res.expires };
            console.log('[ably][user-notify][token ok]', { ablyChannel, expiresIn: res.expires - now });
          } else {
            console.warn('[ably][user-notify][token failed]', { ablyChannel, error: res.error ?? 'no token' });
            if (!cancelled) {
              retryTimeoutRef.current = setTimeout(connect, 10000);
            }
            return;
          }
        } catch (err) {
          console.warn('[ably][user-notify][token error]', { ablyChannel, error: (err as Error).message });
          if (!cancelled) {
            retryTimeoutRef.current = setTimeout(connect, 10000);
          }
          return;
        }
      }

      if (cancelled) return;

      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(ablyChannel)}&accessToken=${encodeURIComponent(tokenRef.current!.token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) {
          setStatus('connected');
          console.log('[ably][user-notify][connected] ✓', { ablyChannel });
        }
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.name === 'conversation.created' && parsed.data) {
            const convPayload: ConversationCreatedPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            console.log('[ably][user-notify][conversation.created]', { conversationId: convPayload.conversationId });
            onConversationCreatedRef.current?.(convPayload);
            return;
          }

          if (parsed.name === 'conversation.deleted' && parsed.data) {
            const delPayload: ConversationDeletedPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            onConversationDeletedRef.current?.(delPayload);
            return;
          }

          if (parsed.name === 'conversation.renamed' && parsed.data) {
            const renamePayload: ConversationRenamedPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            onConversationRenamedRef.current?.(renamePayload);
            return;
          }

          if (parsed.name === 'conversation.membersUpdated' && parsed.data) {
            const membersPayload: ConversationMembersUpdatedPayload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
            onConversationMembersUpdatedRef.current?.(membersPayload);
            return;
          }

          if (parsed.name !== 'notification.new_message' || !parsed.data) return;

          const payload: UserNotificationPayload = typeof parsed.data === 'string'
            ? JSON.parse(parsed.data)
            : parsed.data;

          console.log('[ably][user-notify][event]', { channel: payload.channel, hasMention: payload.hasMention });

          // If the user is viewing this channel, mark it — don't suppress so Layout can signal ChatPage
          if (payload.channel === activeChannelRef.current) {
            payload.isActiveChannel = true;
          }

          onNewMessageRef.current(payload);
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        console.warn('[ably][user-notify][error]', { ablyChannel, readyState: es.readyState });
        if (!cancelled) {
          setStatus('disconnected');
          es.close();
          eventSourceRef.current = null;
          tokenRef.current = null; // force re-fetch on retry
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
      console.log('[ably][user-notify][disconnected]', { ablyChannel });
    };
  }, [userEmail, enabled, cleanup]);

  return { status };
}
