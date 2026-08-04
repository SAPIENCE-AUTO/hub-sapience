import { useEffect, useRef, useCallback, useState } from 'react';
import { getAblyToken } from 'zite-endpoints-sdk';

export type DocChannelStatus = 'connecting' | 'connected' | 'error' | 'disabled';

interface UseDocumentChannelOptions {
  docId: string | null;
  myUserId: string;
  onBlockLock?: (data: any) => void;
  onBlockUnlock?: (data: any) => void;
  onBlockLockHeartbeat?: (data: any) => void;
  onBlockUpdate?: (data: any) => void;
  onStructureChanged?: (data: any) => void;
  onReload?: (data: any) => void;
  enabled?: boolean;
}

export function useDocumentChannel({
  docId,
  myUserId,
  onBlockLock,
  onBlockUnlock,
  onBlockLockHeartbeat,
  onBlockUpdate,
  onStructureChanged,
  onReload,
  enabled = true,
}: UseDocumentChannelOptions): { status: DocChannelStatus } {
  const [status, setStatus] = useState<DocChannelStatus>('disabled');
  const eventSourceRef  = useRef<EventSource | null>(null);
  const tokenRef        = useRef<{ token: string; expires: number } | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback refs
  const cbRef = useRef({ onBlockLock, onBlockUnlock, onBlockLockHeartbeat, onBlockUpdate, onStructureChanged, onReload, myUserId });
  cbRef.current = { onBlockLock, onBlockUnlock, onBlockLockHeartbeat, onBlockUpdate, onStructureChanged, onReload, myUserId };

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
    if (!enabled || !docId) {
      cleanup();
      setStatus('disabled');
      return;
    }

    let cancelled = false;
    const ablyChannel = `doc:${docId}`;

    const connect = async () => {
      setStatus('connecting');

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRef.current || tokenRef.current.expires - now < 300) {
        try {
          const res = await getAblyToken({ channels: [ablyChannel] });
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

      const sseUrl = `https://realtime.ably.io/sse?channels=${encodeURIComponent(ablyChannel)}&accessToken=${encodeURIComponent(tokenRef.current!.token)}&v=1.2`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) setStatus('connected');
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
          if (!data) return;

          // Ignore own events
          if (data.userId === cbRef.current.myUserId) return;

          switch (parsed.name) {
            case 'block.lock':            cbRef.current.onBlockLock?.(data); break;
            case 'block.unlock':          cbRef.current.onBlockUnlock?.(data); break;
            case 'block.lock_heartbeat':  cbRef.current.onBlockLockHeartbeat?.(data); break;
            case 'block.update':          cbRef.current.onBlockUpdate?.(data); break;
            case 'doc.structure_changed': cbRef.current.onStructureChanged?.(data); break;
            case 'doc.reload':            cbRef.current.onReload?.(data); break;
          }
        } catch { /* ignore malformed */ }
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

    return () => {
      cancelled = true;
      cleanup();
      setStatus('disabled');
    };
  }, [docId, enabled, cleanup]);

  return { status };
}
