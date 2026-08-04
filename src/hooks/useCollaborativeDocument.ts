import { useEffect, useRef, useCallback, useState, MutableRefObject } from 'react';
import { publishDocEvent } from 'zite-endpoints-sdk';
import { useDocumentChannel } from './useDocumentChannel';
import type { DocumentModel } from '../components/commercial/brief/docTypes';

// ── Types ────────────────────────────────────────────────────────────────────

type BlockLock = {
  blockId: string;
  lockId: string;
  userId: string;
  userEmail: string;
  userName: string;
  expiresAt: number;
};

interface MyUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface UseCollaborativeDocumentProps {
  docId: string | null;
  setDocument: React.Dispatch<React.SetStateAction<DocumentModel | null>>;
  docRef: MutableRefObject<DocumentModel | null>;
  myUser: MyUser | undefined;
  onReloadDocument: () => Promise<void>;
  enabled?: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCollaborativeDocument({
  docId,
  setDocument,
  docRef,
  myUser,
  onReloadDocument,
  enabled = true,
}: UseCollaborativeDocumentProps) {
  // Locks from OTHER users (triggers re-render for UI)
  const [locks, setLocks] = useState<Record<string, BlockLock>>({});
  const [structureLockOwner, setStructureLockOwner] = useState<string | null>(null);

  // My own locks — refs, no re-render needed
  const myLocksRef   = useRef<Set<string>>(new Set());
  const myLockIdsRef = useRef<Map<string, string>>(new Map()); // blockId → lockId

  // Stable refs for callbacks
  const locksRef     = useRef<Record<string, BlockLock>>({});
  const onReloadRef  = useRef(onReloadDocument);
  const docIdRef     = useRef(docId);
  const myUserRef    = useRef(myUser);

  onReloadRef.current = onReloadDocument;
  docIdRef.current    = docId;
  myUserRef.current   = myUser;

  useEffect(() => { locksRef.current = locks; }, [locks]);

  // ── Lock expiry cleanup (every 2 s) ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setLocks(prev => {
        const expired = Object.keys(prev).filter(k => prev[k].expiresAt < now);
        if (expired.length === 0) return prev;
        const next = { ...prev };
        for (const k of expired) {
          delete next[k];
          if (k === '__structure__') setStructureLockOwner(null);
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [enabled]);

  // ── Heartbeat for my locks (every 5 s) ──────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      if (myLocksRef.current.size === 0) return;
      const currentDocId = docIdRef.current;
      if (!currentDocId || !myUserRef.current) return;
      const newExpiry = Date.now() + 15000;
      for (const blockId of myLocksRef.current) {
        const lockId = myLockIdsRef.current.get(blockId);
        if (!lockId) continue;
        publishDocEvent({ docId: currentDocId, eventType: 'block.lock_heartbeat', blockId, lockId, expiresAt: newExpiry })
          .catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [enabled]);

  // ── Ably event handlers ──────────────────────────────────────────────────

  const handleBlockLock = useCallback((data: any) => {
    const { blockId, lockId, userId, userEmail, userName, expiresAt } = data;
    if (!blockId || !lockId) return;
    setLocks(prev => {
      const existing = prev[blockId];
      if (existing && existing.expiresAt > Date.now()) return prev; // already locked → ignore
      return { ...prev, [blockId]: { blockId, lockId, userId, userEmail, userName, expiresAt } };
    });
    if (blockId === '__structure__') setStructureLockOwner(userName);
  }, []);

  const handleBlockUnlock = useCallback((data: any) => {
    const { blockId, lockId } = data;
    if (!blockId) return;
    setLocks(prev => {
      const existing = prev[blockId];
      if (!existing || existing.lockId !== lockId) return prev;
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
    if (blockId === '__structure__') setStructureLockOwner(null);
  }, []);

  const handleBlockLockHeartbeat = useCallback((data: any) => {
    const { blockId, lockId, expiresAt } = data;
    if (!blockId) return;
    setLocks(prev => {
      const existing = prev[blockId];
      if (!existing || existing.lockId !== lockId) return prev;
      return { ...prev, [blockId]: { ...existing, expiresAt } };
    });
  }, []);

  const handleBlockUpdate = useCallback((data: any) => {
    const { blockId, block, docVersion } = data;
    if (!block || !blockId) return;
    setDocument(prev => {
      if (!prev) return prev;
      const blocks = prev.blocks.map((b: any) => b.id === blockId ? block : b);
      const next = { ...prev, blocks, version: typeof docVersion === 'number' ? docVersion : prev.version };
      if (docRef) docRef.current = next;
      return next;
    });
  }, [setDocument, docRef]);

  const handleStructureChanged = useCallback(() => {
    onReloadRef.current().catch(() => {});
  }, []);

  const handleReload = useCallback(() => {
    onReloadRef.current().catch(() => {});
  }, []);

  // ── SSE subscription ─────────────────────────────────────────────────────
  useDocumentChannel({
    docId,
    myUserId: myUser?.id ?? '',
    onBlockLock:           handleBlockLock,
    onBlockUnlock:         handleBlockUnlock,
    onBlockLockHeartbeat:  handleBlockLockHeartbeat,
    onBlockUpdate:         handleBlockUpdate,
    onStructureChanged:    handleStructureChanged,
    onReload:              handleReload,
    enabled: enabled && !!docId && !!myUser,
  });

  // ── Visibility reconciliation ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !docId) return;
    const handler = () => {
      if (globalThis.document?.visibilityState === 'visible') {
        const now = Date.now();
        setLocks(prev => {
          const expired = Object.keys(prev).filter(k => prev[k].expiresAt < now);
          if (expired.length === 0) return prev;
          const next = { ...prev };
          for (const k of expired) delete next[k];
          return next;
        });
        onReloadRef.current().catch(() => {});
      }
    };
    globalThis.document?.addEventListener('visibilitychange', handler);
    return () => globalThis.document?.removeEventListener('visibilitychange', handler);
  }, [enabled, docId]);

  // ── Cleanup on unmount — release all my locks ────────────────────────────
  useEffect(() => {
    return () => {
      const currentDocId = docIdRef.current;
      if (!currentDocId) return;
      for (const blockId of myLocksRef.current) {
        const lockId = myLockIdsRef.current.get(blockId);
        if (!lockId) continue;
        publishDocEvent({ docId: currentDocId, eventType: 'block.unlock', blockId, lockId }).catch(() => {});
      }
      myLocksRef.current.clear();
      myLockIdsRef.current.clear();
    };
  }, []); // intentionally empty — run only on unmount

  // ── Public API ────────────────────────────────────────────────────────────

  const canEditBlock = useCallback((blockId: string): boolean => {
    const lock = locksRef.current[blockId];
    if (!lock) return true;
    if (lock.expiresAt < Date.now()) return true;
    return false;
  }, []);

  const canModifyStructure = useCallback((): boolean => {
    return canEditBlock('__structure__');
  }, [canEditBlock]);

  const getBlockLockInfo = useCallback((blockId: string): { userName: string; userEmail: string } | null => {
    const lock = locksRef.current[blockId];
    if (!lock || lock.expiresAt < Date.now()) return null;
    return { userName: lock.userName, userEmail: lock.userEmail };
  }, []);

  const acquireBlockLock = useCallback(async (blockId: string): Promise<boolean> => {
    const currentDocId = docIdRef.current;
    if (!currentDocId || !myUserRef.current) return false;
    if (!canEditBlock(blockId)) return false;
    if (myLocksRef.current.has(blockId)) return true;

    const lockId    = crypto.randomUUID().slice(0, 8);
    const expiresAt = Date.now() + 15000;

    // Optimistically register
    myLocksRef.current.add(blockId);
    myLockIdsRef.current.set(blockId, lockId);

    try {
      const result = await publishDocEvent({
        docId: currentDocId,
        eventType: 'block.lock',
        blockId,
        lockId,
        expiresAt,
      });
      if (!result.success) {
        myLocksRef.current.delete(blockId);
        myLockIdsRef.current.delete(blockId);
        return false;
      }
      return true;
    } catch {
      myLocksRef.current.delete(blockId);
      myLockIdsRef.current.delete(blockId);
      return false;
    }
  }, [canEditBlock]);

  const releaseBlockLock = useCallback(async (blockId: string): Promise<void> => {
    const currentDocId = docIdRef.current;
    if (!currentDocId || !myLocksRef.current.has(blockId)) return;
    const lockId = myLockIdsRef.current.get(blockId);
    myLocksRef.current.delete(blockId);
    myLockIdsRef.current.delete(blockId);
    if (!lockId) return;
    publishDocEvent({ docId: currentDocId, eventType: 'block.unlock', blockId, lockId }).catch(() => {});
  }, []);

  const acquireStructureLock  = useCallback(() => acquireBlockLock('__structure__'),  [acquireBlockLock]);
  const releaseStructureLock  = useCallback(() => releaseBlockLock('__structure__'),  [releaseBlockLock]);

  const reloadDocument  = useCallback(async () => { await onReloadRef.current(); }, []);

  return {
    locks,
    structureLockOwner,
    canEditBlock,
    canModifyStructure,
    getBlockLockInfo,
    acquireBlockLock,
    releaseBlockLock,
    acquireStructureLock,
    releaseStructureLock,
    reloadDocument,
  };
}
