import React, { useEffect, useState, useRef, forwardRef, useImperativeHandle, Fragment, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, MoreHorizontal, Pencil, RefreshCw, Trash2, Check, X,
  Bookmark, Save, Share2, Copy, ExternalLink, Link2, Unlink, GripVertical,
} from 'lucide-react';
import {
  getInternalViews, saveInternalView, deleteInternalView, syncExternalView, unlinkExternalView,
  reorderInternalViews,
  GetInternalViewsOutputType,
} from 'zite-endpoints-sdk';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

type InternalView = GetInternalViewsOutputType['views'][0];

// Module-level cache: persist views across board switches and tab changes.
// Same pattern as colCache in useDynamicColumns — survives re-renders entirely.
const internalViewsCache = new Map<string, InternalView[]>();
const inFlightViews      = new Map<string, Promise<GetInternalViewsOutputType>>();

export interface InternalViewsBarHandle {
  notifyViewSaved: (viewId: string, filtersJson: string) => void;
}

interface Props {
  boardId: string;
  projectCode: string;
  boardName: string;
  activeViewId: string | null;
  onViewSelected: (view: InternalView | null) => void;
  currentFiltersJson: string;
  hasUnsavedChanges: boolean;
  onViewUpdated?: (view: InternalView) => void;
}

const EDGE_THRESHOLD = 120;
const MAX_SCROLL_SPEED = 15;
const MIN_DRAG_PX = 5;

export const InternalViewsBar = memo(forwardRef<InternalViewsBarHandle, Props>(function InternalViewsBar({
  boardId, projectCode, boardName,
  activeViewId, onViewSelected, currentFiltersJson,
  hasUnsavedChanges, onViewUpdated,
}: Props, ref) {
  const [views, setViews] = useState<InternalView[]>([]);
  const [loading, setLoading] = useState(false);

  // Inline new view input
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  // Rename inline
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete / share state
  const [deletingView, setDeletingView] = useState<InternalView | null>(null);
  const [syncingViewId, setSyncingViewId] = useState<string | null>(null);
  const [unlinkingViewId, setUnlinkingViewId] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDialogUrl, setShareDialogUrl] = useState<string | null>(null);
  const [shareDialogIsNew, setShareDialogIsNew] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Drag state (for rendering) ─────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState(-1);
  const [ghostData, setGhostData] = useState<{ label: string; initX: number; initY: number } | null>(null);

  // ── Drag refs (stable, no re-render) ──────────────────────────────────
  const dragIdRef        = useRef<string | null>(null);
  const dragActiveRef    = useRef(false);          // true as soon as drag starts
  const thresholdMetRef  = useRef(false);          // true after 5px movement
  const startXRef        = useRef(0);
  const lastClientXRef   = useRef(0);
  const insertIndexRef   = useRef(-1);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef     = useRef<number | null>(null);
  const scrollSpeedRef   = useRef(0);
  const scrollDirRef     = useRef(0);
  const ghostRef         = useRef<HTMLDivElement | null>(null);
  const tabRefs          = useRef<Map<string, HTMLElement>>(new Map());
  const viewsRef         = useRef<InternalView[]>([]);
  viewsRef.current = views;

  useImperativeHandle(ref, () => ({
    notifyViewSaved: (viewId: string, filtersJson: string) => {
      setViews(prev => { const next = prev.map(v => v.id === viewId ? { ...v, filtersJson } : v); internalViewsCache.set(boardId, next); return next; });
    },
  }), []);

  const load = async () => {
    if (!boardId) return;

    // ── Instant cache hit: show stored views immediately, refresh silently ─
    if (internalViewsCache.has(boardId)) {
      setViews(internalViewsCache.get(boardId)!);
      const bid = boardId;
      getInternalViews({ boardId: bid })
        .then(res => { internalViewsCache.set(bid, res.views); setViews(res.views); })
        .catch(() => {});
      return;
    }

    // ── Dedup: if another caller already fetched this boardId, await it ───
    if (inFlightViews.has(boardId)) {
      try {
        const res = await inFlightViews.get(boardId)!;
        internalViewsCache.set(boardId, res.views);
        setViews(res.views);
      } catch { /* silent */ }
      return;
    }

    // ── First fetch: show spinner, populate cache, clear in-flight entry ─
    setLoading(true);
    const bid = boardId;
    const promise = getInternalViews({ boardId: bid });
    inFlightViews.set(bid, promise);
    try {
      const res = await promise;
      internalViewsCache.set(bid, res.views);
      setViews(res.views);
    } catch { /* silent */ } finally {
      inFlightViews.delete(bid);
      setLoading(false);
    }
  };

  useEffect(() => { setViews([]); load(); }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (showNewInput) setTimeout(() => newInputRef.current?.focus(), 50); }, [showNewInput]);
  useEffect(() => { if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50); }, [renamingId]);

  // ── Drag: compute insert index from cursor X ───────────────────────────
  function calcInsertIndex(clientX: number): number {
    const vs = viewsRef.current;
    for (let i = 0; i < vs.length; i++) {
      const el = tabRefs.current.get(vs[i].id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return vs.length;
  }

  // ── Drag: stop & cleanup ───────────────────────────────────────────────
  const stopDrag = useCallback(() => {
    dragActiveRef.current = false;
    thresholdMetRef.current = false;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    scrollSpeedRef.current = 0;
    scrollDirRef.current = 0;
    document.body.style.cursor = '';
  }, []);

  // ── Drag: RAF auto-scroll loop ─────────────────────────────────────────
  const startScrollLoop = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    const tick = () => {
      if (!dragActiveRef.current) { scrollRafRef.current = null; return; }
      const container = scrollContainerRef.current;
      if (!container) { scrollRafRef.current = requestAnimationFrame(tick); return; }

      const rect = container.getBoundingClientRect();
      const x = lastClientXRef.current;
      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      let targetDir = 0, targetSpeed = 0;

      if (x < rect.left + EDGE_THRESHOLD && container.scrollLeft > 0) {
        targetDir = -1;
        targetSpeed = Math.max(3, Math.round(((rect.left + EDGE_THRESHOLD - x) / EDGE_THRESHOLD) * MAX_SCROLL_SPEED));
      } else if (x > rect.right - EDGE_THRESHOLD && container.scrollLeft < maxScroll) {
        targetDir = 1;
        targetSpeed = Math.max(3, Math.round(((x - (rect.right - EDGE_THRESHOLD)) / EDGE_THRESHOLD) * MAX_SCROLL_SPEED));
      }

      if (targetDir !== 0) {
        scrollDirRef.current = targetDir;
        scrollSpeedRef.current += (targetSpeed - scrollSpeedRef.current) * 0.28;
      } else {
        scrollSpeedRef.current *= 0.72;
        if (scrollSpeedRef.current < 0.5) { scrollSpeedRef.current = 0; scrollDirRef.current = 0; }
      }

      if (scrollDirRef.current !== 0 && scrollSpeedRef.current > 0.5) {
        container.scrollLeft = Math.max(0, Math.min(maxScroll,
          container.scrollLeft + scrollDirRef.current * scrollSpeedRef.current));
      }
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Drag: stable listener wrappers ─────────────────────────────────────
  const pointerMoveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  const pointerUpHandlerRef   = useRef<(e: PointerEvent) => void>(() => {});
  const stablePointerMove = useCallback((e: PointerEvent) => { pointerMoveHandlerRef.current(e); }, []);
  const stablePointerUp   = useCallback((e: PointerEvent) => { pointerUpHandlerRef.current(e); }, []);

  // ── Drag: pointer move ─────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragActiveRef.current) return;
    lastClientXRef.current = e.clientX;

    // Move ghost imperatively (no re-render)
    if (ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX + 12}px`;
      ghostRef.current.style.top  = `${e.clientY - 16}px`;
    }

    // Gate: only compute insertion after threshold
    if (!thresholdMetRef.current) {
      if (Math.abs(e.clientX - startXRef.current) < MIN_DRAG_PX) return;
      thresholdMetRef.current = true;
      document.body.style.cursor = 'grabbing';
    }

    const newIdx = calcInsertIndex(e.clientX);
    if (newIdx !== insertIndexRef.current) {
      insertIndexRef.current = newIdx;
      setInsertIndex(newIdx);
    }
  }, []);

  // ── Drag: pointer up ───────────────────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    window.removeEventListener('pointermove', stablePointerMove);
    window.removeEventListener('pointerup',   stablePointerUp);
    const did          = dragIdRef.current;
    const idx          = insertIndexRef.current;
    const wasActive    = thresholdMetRef.current;
    stopDrag();
    dragIdRef.current      = null;
    insertIndexRef.current = -1;
    setDragId(null);
    setInsertIndex(-1);
    setGhostData(null);
    if (did && wasActive && idx >= 0) handleReorder(did, idx);
  }, [stablePointerMove, stablePointerUp, stopDrag]); // eslint-disable-line react-hooks/exhaustive-deps

  pointerMoveHandlerRef.current = handlePointerMove;
  pointerUpHandlerRef.current   = handlePointerUp;

  // ── Drag: start ────────────────────────────────────────────────────────
  function startDrag(e: React.PointerEvent, viewId: string) {
    e.preventDefault();
    dragIdRef.current      = viewId;
    dragActiveRef.current  = true;
    thresholdMetRef.current = false;
    startXRef.current      = e.clientX;
    lastClientXRef.current = e.clientX;
    insertIndexRef.current = viewsRef.current.findIndex(v => v.id === viewId);

    setDragId(viewId);

    const view = viewsRef.current.find(v => v.id === viewId);
    setGhostData({ label: view?.viewName ?? '', initX: e.clientX + 12, initY: e.clientY - 16 });

    // Find horizontal scroll container
    let el: HTMLElement | null = e.currentTarget as HTMLElement;
    while (el) {
      const ox = window.getComputedStyle(el).overflowX;
      if (el.scrollWidth > el.clientWidth && (ox === 'auto' || ox === 'scroll')) {
        scrollContainerRef.current = el;
        break;
      }
      el = el.parentElement;
    }

    window.addEventListener('pointermove', stablePointerMove);
    window.addEventListener('pointerup',   stablePointerUp);
    startScrollLoop();
  }

  // ── Drag: reorder ──────────────────────────────────────────────────────
  function handleReorder(draggingId: string, insertIdx: number) {
    const vs = viewsRef.current;
    const dragIdx = vs.findIndex(v => v.id === draggingId);
    if (dragIdx === -1 || dragIdx === insertIdx || dragIdx + 1 === insertIdx) return;

    const draggingView = vs[dragIdx];
    const without = vs.filter(v => v.id !== draggingId);
    const adjusted = dragIdx < insertIdx ? insertIdx - 1 : insertIdx;
    const newViews = [...without.slice(0, adjusted), draggingView, ...without.slice(adjusted)];

    setViews(newViews);
    internalViewsCache.set(boardId, newViews);
    reorderInternalViews({
      viewOrders: newViews.map((v, i) => ({ id: v.id, order: i })),
    }).catch(() => toast.error('Error al guardar el orden'));
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDrag();
      window.removeEventListener('pointermove', stablePointerMove);
      window.removeEventListener('pointerup',   stablePointerUp);
    };
  }, [stablePointerMove, stablePointerUp, stopDrag]);

  // ── View handlers ──────────────────────────────────────────────────────

  const handleSaveNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const emptyFiltersJson = JSON.stringify({ filterRules: [], filterMode: 'and', columnFilters: {}, hiddenColumns: [], sortColumn: null, sortDirection: 'asc' });
    try {
      const res = await saveInternalView({ viewName: name, boardId, projectCode, boardName, filtersJson: emptyFiltersJson });
      const newView: InternalView = { id: res.id, viewName: res.viewName, filtersJson: emptyFiltersJson };
      setViews(prev => { const next = [...prev, newView]; internalViewsCache.set(boardId, next); return next; });
      setNewName(''); setShowNewInput(false);
      onViewSelected(newView);
      toast.success(`Vista "${name}" guardada`);
    } catch { toast.error('Error al guardar la vista'); }
    setSaving(false);
  };

  const handleUpdateFilters = async (view: InternalView) => {
    try {
      await saveInternalView({ id: view.id, viewName: view.viewName, boardId, projectCode, boardName, filtersJson: currentFiltersJson });
      const updatedView = { ...view, filtersJson: currentFiltersJson };
      setViews(prev => { const next = prev.map(v => v.id === view.id ? updatedView : v); internalViewsCache.set(boardId, next); return next; });
      onViewUpdated?.(updatedView);
      toast.success('Vista guardada');
    } catch { toast.error('Error al actualizar la vista'); }
  };

  const handleRename = async (view: InternalView) => {
    const name = renameVal.trim();
    if (!name || name === view.viewName) { setRenamingId(null); return; }
    try {
      await saveInternalView({ id: view.id, viewName: name, boardId, projectCode, boardName, filtersJson: view.filtersJson });
      setViews(prev => { const next = prev.map(v => v.id === view.id ? { ...v, viewName: name } : v); internalViewsCache.set(boardId, next); return next; });
      if (activeViewId === view.id) onViewSelected({ ...view, viewName: name });
      toast.success('Vista renombrada');
    } catch { toast.error('Error al renombrar'); }
    setRenamingId(null);
  };

  const handleDelete = async () => {
    if (!deletingView) return;
    try {
      await deleteInternalView({ id: deletingView.id });
      setViews(prev => { const next = prev.filter(v => v.id !== deletingView.id); internalViewsCache.set(boardId, next); return next; });
      if (activeViewId === deletingView.id) onViewSelected(null);
      toast.success('Vista eliminada');
    } catch { toast.error('Error al eliminar la vista'); }
    setDeletingView(null);
  };

  const handleSyncExternal = async (view: InternalView) => {
    setSyncingViewId(view.id);
    try {
      const res = await syncExternalView({ internalViewId: view.id, viewName: view.viewName, boardId, projectCode, boardName });
      setViews(prev => { const next = prev.map(v => v.id === view.id ? { ...v, sharedToken: res.sharedToken, sharedUrl: res.shareUrl } : v); internalViewsCache.set(boardId, next); return next; });
      setShareDialogUrl(res.shareUrl); setShareDialogIsNew(res.isNew); setShareDialogOpen(true); setCopied(false);
      await navigator.clipboard.writeText(res.shareUrl);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
      toast.success(res.isNew ? 'Vista externa creada — link copiado' : 'Vista externa actualizada — link copiado');
    } catch { toast.error('Error al sincronizar la vista externa'); }
    setSyncingViewId(null);
  };

  const handleUnlinkExternal = async (view: InternalView) => {
    setUnlinkingViewId(view.id);
    try {
      await unlinkExternalView({ internalViewId: view.id });
      setViews(prev => { const next = prev.map(v => v.id === view.id ? { ...v, sharedToken: undefined, sharedUrl: undefined } : v); internalViewsCache.set(boardId, next); return next; });
      toast.success('Link externo desactivado');
    } catch { toast.error('Error al desactivar el link externo'); }
    setUnlinkingViewId(null);
  };

  const handleQuickCopy = async (view: InternalView) => {
    if (!view.sharedUrl) return;
    await navigator.clipboard.writeText(view.sharedUrl);
    toast.success('Link copiado al portapapeles');
  };

  const handleCopyDialogUrl = async () => {
    if (!shareDialogUrl) return;
    await navigator.clipboard.writeText(shareDialogUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (!boardId) return null;

  const tabCls = (isActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap border ${
      isActive
        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
        : 'bg-card text-muted-foreground border-border/50 hover:text-foreground hover:border-border hover:bg-muted/50'
    }`;

  return (
    <>
      <div className="flex items-center gap-1.5 px-6 py-2 bg-muted/20 border-b border-border/40 overflow-x-auto flex-shrink-0">

        {/* "Todos" tab */}
        <button className={tabCls(activeViewId === null)} onClick={() => onViewSelected(null)}>
          Todos
        </button>

        {/* View tabs */}
        {views.map((view, i) => (
          <Fragment key={view.id}>
            {/* Insertion indicator before this tab */}
            {dragId && insertIndex === i && (
              <div className="relative flex-shrink-0 mx-0.5 flex flex-col items-center" style={{ zIndex: 50 }}>
                <div className="w-0 h-0" style={{
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderTop: '6px solid hsl(var(--primary))',
                }} />
                <div
                  className="w-[3px] h-5 bg-primary rounded-full"
                  style={{ boxShadow: '0 0 8px 3px hsl(var(--primary)/0.5)' }}
                />
              </div>
            )}

            <div className="flex items-center flex-shrink-0">
              {renamingId === view.id ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-primary bg-card">
                  <input
                    ref={renameInputRef}
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(view);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="text-xs bg-transparent outline-none w-28 text-foreground"
                  />
                  <button onClick={() => handleRename(view)} className="text-primary hover:opacity-70">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => setRenamingId(null)} className="text-muted-foreground hover:opacity-70">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div
                  ref={el => { if (el) tabRefs.current.set(view.id, el); else tabRefs.current.delete(view.id); }}
                  className={`flex items-center gap-0 group/tab rounded-md overflow-hidden border transition-all select-none ${
                    activeViewId === view.id
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-muted-foreground border-border/50 hover:border-border hover:bg-muted/50'
                  } ${dragId === view.id ? 'opacity-30' : ''}`}
                >
                  {/* Grip handle */}
                  <button
                    className={`pl-1.5 py-1.5 opacity-0 group-hover/tab:opacity-60 hover:!opacity-100 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none ${
                      activeViewId === view.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}
                    title="Arrastrar para reordenar"
                    onPointerDown={e => startDrag(e, view.id)}
                  >
                    <GripVertical className="w-3 h-3" />
                  </button>

                  {/* Tab label */}
                  <button
                    className="px-2 py-1.5 text-xs font-medium whitespace-nowrap flex items-center gap-1.5"
                    onClick={() => !thresholdMetRef.current && onViewSelected(view)}
                  >
                    {view.sharedToken && (
                      <Link2 className={`w-2.5 h-2.5 flex-shrink-0 ${activeViewId === view.id ? 'text-primary-foreground/60' : 'text-muted-foreground/50'}`} />
                    )}
                    {view.viewName}
                  </button>

                  {/* Options menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={`pr-1.5 pl-0.5 py-1.5 opacity-0 group-hover/tab:opacity-100 transition-opacity ${
                        activeViewId === view.id
                          ? 'text-primary-foreground/70 hover:text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem className="text-xs gap-2" onClick={() => handleUpdateFilters(view)}>
                        <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /> Actualizar filtros
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {view.sharedToken ? (
                        <>
                          <DropdownMenuItem className="text-xs gap-2" onClick={() => handleQuickCopy(view)}>
                            <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Copiar link externo
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-xs gap-2 text-destructive focus:text-destructive"
                            disabled={unlinkingViewId === view.id}
                            onClick={() => handleUnlinkExternal(view)}
                          >
                            {unlinkingViewId === view.id
                              ? <div className="w-3.5 h-3.5 border border-destructive/30 border-t-destructive rounded-full animate-spin" />
                              : <Unlink className="w-3.5 h-3.5" />}
                            Desactivar link externo
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem
                          className="text-xs gap-2"
                          disabled={syncingViewId === view.id}
                          onClick={() => handleSyncExternal(view)}
                        >
                          {syncingViewId === view.id
                            ? <div className="w-3.5 h-3.5 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                            : <Share2 className="w-3.5 h-3.5 text-muted-foreground" />}
                          Compartir como vista externa
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-xs gap-2" onClick={() => { setRenamingId(view.id); setRenameVal(view.viewName); }}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Renombrar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-xs gap-2 text-destructive focus:text-destructive" onClick={() => setDeletingView(view)}>
                        <Trash2 className="w-3.5 h-3.5" /> Eliminar vista
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </Fragment>
        ))}

        {/* Insertion indicator at end */}
        {dragId && insertIndex === views.length && (
          <div className="relative flex-shrink-0 mx-0.5 flex flex-col items-center" style={{ zIndex: 50 }}>
            <div className="w-0 h-0" style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid hsl(var(--primary))',
            }} />
            <div
              className="w-[3px] h-5 bg-primary rounded-full"
              style={{ boxShadow: '0 0 8px 3px hsl(var(--primary)/0.5)' }}
            />
          </div>
        )}

        {/* New view input / button */}
        {showNewInput ? (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-primary bg-card flex-shrink-0">
            <Bookmark className="w-3 h-3 text-primary flex-shrink-0" />
            <input
              ref={newInputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveNew();
                if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
              }}
              placeholder="Nombre de la vista..."
              className="text-xs bg-transparent outline-none w-36 text-foreground placeholder:text-muted-foreground/50"
            />
            <button onClick={handleSaveNew} disabled={saving || !newName.trim()} className="text-primary hover:opacity-70 disabled:opacity-40">
              {saving ? <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" /> : <Check className="w-3 h-3" />}
            </button>
            <button onClick={() => { setShowNewInput(false); setNewName(''); }} className="text-muted-foreground hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors flex-shrink-0"
            onClick={() => setShowNewInput(true)}
            title="Guardar filtros actuales como nueva vista"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nueva vista</span>
          </button>
        )}

        {loading && <div className="ml-1 w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin flex-shrink-0" />}

        {hasUnsavedChanges && activeViewId && views.find(v => v.id === activeViewId) && (
          <button
            onClick={() => { const av = views.find(v => v.id === activeViewId); if (av) handleUpdateFilters(av); }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border bg-primary/10 text-primary border-primary/25 hover:bg-primary/20 transition-colors flex-shrink-0 whitespace-nowrap ml-auto"
          >
            <Save className="w-3 h-3" /> Guardar en vista
          </button>
        )}
      </div>

      {/* ── Ghost floating tab ─────────────────────────────────────────────── */}
      {ghostData && createPortal(
        <div
          ref={ghostRef}
          className="pointer-events-none select-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-primary/50 bg-card text-xs font-medium text-foreground"
          style={{
            position: 'fixed',
            left: ghostData.initX,
            top: ghostData.initY,
            zIndex: 9999,
            opacity: 0.92,
            transform: 'rotate(-2deg) scale(1.04)',
            boxShadow: '0 8px 24px hsl(var(--primary)/0.25), 0 4px 10px rgba(0,0,0,0.18)',
            backdropFilter: 'blur(2px)',
            whiteSpace: 'nowrap',
          }}
        >
          <GripVertical className="w-3 h-3 text-primary/70 flex-shrink-0" />
          {ghostData.label}
        </div>,
        document.body
      )}

      {/* ── Share URL Dialog ───────────────────────────────────────────────── */}
      <Dialog open={shareDialogOpen} onOpenChange={o => { if (!o) { setShareDialogOpen(false); setShareDialogUrl(null); setCopied(false); } }}>
        <DialogContent className="sm:max-w-3xl rounded-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Share2 className="w-4 h-4 text-primary" />
              </div>
              {shareDialogIsNew ? 'Vista externa creada' : 'Vista externa actualizada'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              {shareDialogIsNew
                ? 'Comparte este link con personas externas. Podrán ver los datos filtrados sin necesidad de iniciar sesión.'
                : 'El link existente fue actualizado con los filtros actuales. El URL no cambia — quienes ya tenían el link verán los datos nuevos automáticamente.'}
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border text-xs text-foreground font-mono overflow-hidden">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="truncate">{shareDialogUrl}</span>
              </div>
              <button onClick={handleCopyDialogUrl} title="Copiar link"
                className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-all flex-shrink-0 ${copied ? 'bg-green-500/10 border-green-500/30 text-green-600' : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              {shareDialogUrl && (
                <a href={shareDialogUrl} target="_blank" rel="noopener noreferrer">
                  <button title="Abrir en nueva pestaña" className="flex items-center justify-center w-9 h-9 rounded-lg border bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex-shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border/50">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${shareDialogIsNew ? 'bg-green-500' : 'bg-primary'}`} />
              <p className="text-xs text-muted-foreground">
                {shareDialogIsNew ? 'La vista está activa y accesible desde el link' : 'El mismo link ahora refleja los filtros actualizados'}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deletingView} onOpenChange={o => { if (!o) setDeletingView(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar vista "{deletingView?.viewName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Los filtros guardados en esta vista se perderán. Los datos del tablero no se verán afectados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}));
