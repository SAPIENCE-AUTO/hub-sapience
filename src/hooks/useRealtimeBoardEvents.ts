import { useEffect, useRef, useCallback, useState } from 'react';
import { getCachedAblyToken, invalidateAblyToken } from '../lib/ablyTokenCache';

type DeletedPayload = { id: string; projectCode: string; senderEmail?: string; changeType?: string };

export type BoardFieldUpdatedPayload = {
  projectCode: string;
  boardId: string;
  entityType: 'recruitmentRow' | 'task' | 'event' | 'unknown';
  fieldType: 'dynamic' | 'fixed';
  rowId: string;
  columnId?: string;
  value?: { textValue?: string; numberValue?: number; dateValue?: string; booleanValue?: boolean; fileUrl?: string };
  fields?: Record<string, unknown>;
  senderEmail?: string;
  timestamp?: string;
};

type UseRealtimeBoardEventsOptions = {
  projectCode: string | null;
  userEmail: string;
  onTaskDeleted?: (payload: DeletedPayload) => void;
  onEventDeleted?: (payload: DeletedPayload) => void;
  onRecruitmentDeleted?: (payload: DeletedPayload) => void;
  onRecruitmentGroupsChanged?: (payload: DeletedPayload) => void;
  onRecruitmentRowsChanged?: (payload: DeletedPayload) => void;
  onBoardFieldUpdated?: (payload: BoardFieldUpdatedPayload) => void;
  enabled?: boolean;
};

export type RealtimeStatus = 'connecting' | 'connected' | 'error' | 'disabled';

export function useRealtimeBoardEvents({
  projectCode,
  userEmail,
  onTaskDeleted,
  onEventDeleted,
  onRecruitmentDeleted,
  onRecruitmentGroupsChanged,
  onRecruitmentRowsChanged,
  onBoardFieldUpdated,
  enabled = true,
}: UseRealtimeBoardEventsOptions): { status: RealtimeStatus } {
  const onTaskDeletedRef               = useRef(onTaskDeleted);
  const onEventDeletedRef              = useRef(onEventDeleted);
  const onRecruitmentDeletedRef        = useRef(onRecruitmentDeleted);
  const onRecruitmentGroupsChangedRef  = useRef(onRecruitmentGroupsChanged);
  const onRecruitmentRowsChangedRef    = useRef(onRecruitmentRowsChanged);
  const onBoardFieldUpdatedRef         = useRef(onBoardFieldUpdated);
  onTaskDeletedRef.current               = onTaskDeleted;
  onEventDeletedRef.current              = onEventDeleted;
  onRecruitmentDeletedRef.current        = onRecruitmentDeleted;
  onRecruitmentGroupsChangedRef.current  = onRecruitmentGroupsChanged;
  onRecruitmentRowsChangedRef.current    = onRecruitmentRowsChanged;
  onBoardFieldUpdatedRef.current         = onBoardFieldUpdated;

  const [status, setStatus] = useState<RealtimeStatus>('disabled');
  const eventSourceRef      = useRef<EventSource | null>(null);
  const tokenRef            = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Exponential backoff: starts at 3s, doubles on each error, caps at 30s
  const retryDelayRef       = useRef(3000);
  const activeChannelKeyRef = useRef('');

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
    if (!enabled || !projectCode) {
      cleanup();
      activeChannelKeyRef.current = '';
      setStatus('disabled');
      return;
    }

    // Skip reconnect if we already have a live (or connecting) EventSource for this channel
    const channelKey = `${projectCode}::${userEmail}`;
    if (
      channelKey === activeChannelKeyRef.current &&
      eventSourceRef.current !== null &&
      eventSourceRef.current.readyState !== EventSource.CLOSED
    ) {
      return;
    }
    activeChannelKeyRef.current = channelKey;

    const ablyChannel = `board:${projectCode}`;
    console.log('[ably-board] subscribing', { channel: ablyChannel, projectCode, enabled, userEmail });
    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');

      // Get or refresh token — uses shared cache to avoid duplicate requests
      // when useProjectPresence is also connecting to the same channel
      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        const tokenResult = await getCachedAblyToken(ablyChannel);
        if (tokenResult) {
          tokenRef.current = tokenResult;
        } else {
          console.warn('[ably][board] Token failed');
          setStatus('error');
          if (!cancelled) retryTimeoutRef.current = setTimeout(connect, retryDelayRef.current);
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
          // Reset backoff on successful connection
          retryDelayRef.current = 3000;
        }
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const data: DeletedPayload = typeof parsed.data === 'string'
            ? JSON.parse(parsed.data)
            : parsed.data;

          // Handle recruitment.groups.changed BEFORE senderEmail filter —
          // all tabs (even same user) should refresh group structure
          if (parsed.name === 'recruitment.groups.changed' && data?.projectCode) {
            console.log('[ably-board] received recruitment.groups.changed', {
              data,
              senderEmail: data?.senderEmail,
              userEmail,
              isSameUser: data?.senderEmail === userEmail,
            });
            onRecruitmentGroupsChangedRef.current?.(data);
            return;
          }

          // Handle recruitment.rows.changed BEFORE senderEmail filter —
          // all tabs (even same user) should refresh row list
          if (parsed.name === 'recruitment.rows.changed' && data?.projectCode) {
            console.log('[ably-board] received recruitment.rows.changed', {
              data,
              senderEmail: data?.senderEmail,
              userEmail,
              isSameUser: data?.senderEmail === userEmail,
            });
            onRecruitmentRowsChangedRef.current?.(data);
            return;
          }

          // Handle board.field.updated BEFORE senderEmail filter —
          // allows same-user sync across tabs
          if (parsed.name === 'board.field.updated' && data) {
            onBoardFieldUpdatedRef.current?.(data as any);
            return;
          }

          // Ignore own events for all other event types
          if (data?.senderEmail && data.senderEmail === userEmail) {
            console.log('[ably-board] ignored own event by senderEmail', { event: parsed.name, senderEmail: data.senderEmail, userEmail });
            return;
          }

          if (parsed.name === 'task.deleted' && data?.id) {
            onTaskDeletedRef.current?.(data);
          } else if (parsed.name === 'event.deleted' && data?.id) {
            onEventDeletedRef.current?.(data);
          } else if (parsed.name === 'recruitment.deleted' && data?.id) {
            onRecruitmentDeletedRef.current?.(data);
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        if (!cancelled) {
          setStatus('error');
          es.close();
          eventSourceRef.current = null;
          // Invalidate shared token cache so next connect fetches a fresh token
          invalidateAblyToken(ablyChannel);
          tokenRef.current = null;
          // Exponential backoff: double delay on each error, cap at 30s
          retryTimeoutRef.current = setTimeout(connect, retryDelayRef.current);
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
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
          invalidateAblyToken(ablyChannel);
          tokenRef.current = null;
          connect();
        }
      }
    }, 50 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(tokenRefreshInterval);
      cleanup();
      activeChannelKeyRef.current = '';
      setStatus('disabled');
    };
  }, [projectCode, enabled, userEmail, cleanup]);

  return { status };
}
