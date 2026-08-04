import { useState, useEffect, useRef, useCallback, createRef } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useDebouncedCallback } from 'use-debounce';
import { uploadFile } from 'zite-file-upload-sdk';
import { getDocBlock, saveDocBlock } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2 } from 'lucide-react';
import ParagraphEditor, { ParagraphEditorHandle } from './commercial/brief/ParagraphEditor';
import ImageBlockEditor from './commercial/brief/ImageBlockEditor';
import EntityMentionMenu from './commercial/brief/EntityMentionMenu';
import {
  DocumentModel, ContentBlock, ParagraphBlock, HeadingBlock, ListItemBlock, ImageBlock,
  TriggerState, RefInline,
  generateBlockId, makeEmptyDoc, migrateMarkdownToDoc, mergeAdjacentText,
} from './commercial/brief/docTypes';
import { useCollaborativeDocument } from '../hooks/useCollaborativeDocument';

type SaveStatus = 'idle' | 'saving' | 'saved';

interface Props {
  blockId: string;
  onMetaChange?: (authorName: string, updatedAt: string) => void;
}

export default function MinutaEditor({ blockId, onMetaChange }: Props) {
  const { user } = useAuth();
  const [doc, setDoc] = useState<DocumentModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const triggerBlockId   = useRef<string | null>(null);
  const focusedBlockRef  = useRef<string | null>(null);
  const docRef           = useRef<DocumentModel | null>(null);
  const opTypeRef        = useRef<'block_update' | 'structure_update'>('block_update');
  const paraRefs         = useRef<Map<string, React.RefObject<ParagraphEditorHandle>>>(new Map());
  const onMetaChangeRef  = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;

  useEffect(() => { docRef.current = doc; }, [doc]);

  const getParaRef = useCallback((id: string) => {
    if (!paraRefs.current.has(id)) paraRefs.current.set(id, createRef<ParagraphEditorHandle>());
    return paraRefs.current.get(id)!;
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const { block } = await getDocBlock({ id: blockId });
        if (cancelled || !block) return;
        const by = user?.email ?? '';
        if (block.documentJson) {
          try {
            const parsed = JSON.parse(block.documentJson) as DocumentModel;
            setDoc(parsed); docRef.current = parsed;
          } catch {
            const migrated = migrateMarkdownToDoc(block.content ?? '', by);
            setDoc(migrated); docRef.current = migrated;
          }
        } else if (block.content) {
          const migrated = migrateMarkdownToDoc(block.content, by);
          setDoc(migrated); docRef.current = migrated;
        } else {
          const empty = makeEmptyDoc(by);
          setDoc(empty); docRef.current = empty;
        }
        if (block.authorName && block.updatedAt) onMetaChangeRef.current?.(block.authorName, block.updatedAt);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [blockId, user?.email]);

  // ── Reload from DB (for reconciliation) ──────────────────────────────────
  const reloadDocument = useCallback(async () => {
    try {
      const { block } = await getDocBlock({ id: blockId });
      if (!block) return;
      const by = user?.email ?? '';
      if (block.documentJson) {
        try {
          const parsed = JSON.parse(block.documentJson) as DocumentModel;
          setDoc(parsed); docRef.current = parsed;
        } catch {
          const migrated = migrateMarkdownToDoc(block.content ?? '', by);
          setDoc(migrated); docRef.current = migrated;
        }
      }
      if (block.authorName && block.updatedAt) onMetaChangeRef.current?.(block.authorName, block.updatedAt);
    } catch { /* silent */ }
  }, [blockId, user?.email]);

  // ── Collaboration hook ────────────────────────────────────────────────────
  const collab = useCollaborativeDocument({
    docId: blockId,
    setDocument: setDoc,
    docRef,
    myUser: user ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } : undefined,
    onReloadDocument: reloadDocument,
    enabled: !!user,
  });

  // ── Debounced save ────────────────────────────────────────────────────────
  const debouncedSave = useDebouncedCallback(async (jsonStr: string) => {
    setStatus('saving');
    try {
      const result = await saveDocBlock({
        id: blockId,
        documentJson: jsonStr,
        expectedVersion: docRef.current?.version,
        changedBlockId: opTypeRef.current === 'block_update' ? (focusedBlockRef.current ?? undefined) : undefined,
        operationType: opTypeRef.current,
      });

      if (result.conflict) {
        setStatus('idle');
        reloadDocument().catch(() => {});
        return;
      }

      if (result.savedVersion !== undefined) {
        setDoc(prev => prev ? { ...prev, version: result.savedVersion! } : prev);
        if (docRef.current) docRef.current = { ...docRef.current, version: result.savedVersion };
      }

      const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || 'tú';
      onMetaChangeRef.current?.(name, new Date().toISOString());
      setStatus('saved');
    } catch { setStatus('idle'); }
  }, 1500);

  // ── Image helpers ─────────────────────────────────────────────────────────
  const insertImageBlock = useCallback((url: string) => {
    if (!collab.canModifyStructure()) return;
    opTypeRef.current = 'structure_update';
    const imgBlock: ImageBlock  = { id: generateBlockId(), type: 'image', url };
    const newPara: ParagraphBlock = { id: generateBlockId(), type: 'paragraph', content: [] };
    setDoc(prev => {
      if (!prev) return prev;
      const blocks = [...prev.blocks];
      const insertAfterIdx = focusedBlockRef.current
        ? blocks.findIndex(b => b.id === focusedBlockRef.current)
        : blocks.length - 1;
      const idx = insertAfterIdx >= 0 ? insertAfterIdx + 1 : blocks.length;
      blocks.splice(idx, 0, imgBlock, newPara);
      const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
    setFocusBlockId(newPara.id);
  }, [debouncedSave, collab.canModifyStructure]);

  const handleImageInsert = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      insertImageBlock(fileUrl);
    } catch { /* silent */ }
    setUploading(false);
  }, [insertImageBlock]);

  const handleDeleteImage = useCallback((id: string) => {
    if (!collab.canModifyStructure()) return;
    opTypeRef.current = 'structure_update';
    setDoc(prev => {
      if (!prev) return prev;
      const next = { ...prev, blocks: prev.blocks.filter(b => b.id !== id), updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
  }, [debouncedSave, collab.canModifyStructure]);

  // ── Block callbacks ───────────────────────────────────────────────────────
  const handleBlockChange = useCallback((updated: ContentBlock) => {
    focusedBlockRef.current = updated.id;
    opTypeRef.current = 'block_update';
    setStatus('idle');
    setDoc(prev => {
      if (!prev) return prev;
      const blocks = prev.blocks.map(b => b.id === updated.id ? updated : b);
      const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
  }, [debouncedSave]);

  const handleChangeBlockType = useCallback((blockId: string, newType:
    | { type: 'paragraph' }
    | { type: 'heading'; level: 1 | 2 | 3 }
    | { type: 'listItem'; listType: 'bullet' | 'number' }
  ) => {
    focusedBlockRef.current = blockId;
    opTypeRef.current = 'block_update';
    setDoc(prev => {
      if (!prev) return prev;
      const blocks = prev.blocks.map(b => {
        if (b.id !== blockId || b.type === 'image') return b;
        const content = (b as ContentBlock).content;
        if (newType.type === 'paragraph') return { id: b.id, type: 'paragraph', content } as ParagraphBlock;
        if (newType.type === 'heading')   return { id: b.id, type: 'heading',   level: newType.level, content } as HeadingBlock;
        return { id: b.id, type: 'listItem', listType: newType.listType, content } as ListItemBlock;
      });
      const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
  }, [debouncedSave]);

  const { canModifyStructure } = collab;

  const handleEnter = useCallback((afterId: string) => {
    if (!canModifyStructure()) return;
    opTypeRef.current = 'structure_update';
    const currentBlock = docRef.current?.blocks.find(b => b.id === afterId);

    if (currentBlock?.type === 'listItem') {
      const listBlock = currentBlock as ListItemBlock;
      const contentText = listBlock.content.reduce((s, n) => s + (n.type === 'text' ? n.text : '\u200B'), '').trim();
      if (!contentText) {
        const newPara: ParagraphBlock = { id: afterId, type: 'paragraph', content: [] };
        setDoc(prev => {
          if (!prev) return prev;
          const blocks = prev.blocks.map(b => b.id === afterId ? newPara : b);
          const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
          docRef.current = next;
          debouncedSave(JSON.stringify(next));
          return next;
        });
        return;
      }
      const newId = generateBlockId();
      const newItem: ListItemBlock = { id: newId, type: 'listItem', listType: listBlock.listType, content: [] };
      setDoc(prev => {
        if (!prev) return prev;
        const idx = prev.blocks.findIndex(b => b.id === afterId);
        const blocks = [...prev.blocks];
        blocks.splice(idx + 1, 0, newItem);
        const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
        docRef.current = next;
        debouncedSave(JSON.stringify(next));
        return next;
      });
      setFocusBlockId(newId);
      return;
    }

    const newId = generateBlockId();
    const newBlock: ParagraphBlock = { id: newId, type: 'paragraph', content: [] };
    setDoc(prev => {
      if (!prev) return prev;
      const idx = prev.blocks.findIndex(b => b.id === afterId);
      const blocks = [...prev.blocks];
      blocks.splice(idx + 1, 0, newBlock);
      const next = { ...prev, blocks, updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
    setFocusBlockId(newId);
  }, [debouncedSave, canModifyStructure]);

  const handleBackspace = useCallback((blockId: string) => {
    if (!canModifyStructure()) return;
    opTypeRef.current = 'structure_update';
    const blocks = docRef.current?.blocks;
    if (!blocks || blocks.length <= 1) return;
    const idx = blocks.findIndex(b => b.id === blockId);
    if (idx <= 0) return;
    const prevBlock = blocks[idx - 1];
    const currBlock = blocks[idx];
    if (prevBlock.type === 'image' || currBlock.type === 'image') return;
    const prev = prevBlock as ContentBlock;
    const curr = currBlock as ContentBlock;
    const merged: ContentBlock = { ...prev, content: mergeAdjacentText([...prev.content, ...curr.content]) };
    paraRefs.current.delete(blockId);
    setDoc(d => {
      if (!d) return d;
      const nb = [...d.blocks];
      nb[idx - 1] = merged;
      nb.splice(idx, 1);
      const next = { ...d, blocks: nb, updatedAt: new Date().toISOString() };
      docRef.current = next;
      debouncedSave(JSON.stringify(next));
      return next;
    });
    setFocusBlockId(prevBlock.id);
  }, [debouncedSave, canModifyStructure]);

  const handleTrigger = useCallback((bId: string, state: TriggerState | null) => {
    triggerBlockId.current = state ? bId : null;
    setTrigger(state);
  }, []);

  const handleMentionSelect = useCallback((ref: RefInline) => {
    const bId = triggerBlockId.current;
    if (bId) paraRefs.current.get(bId)?.current?.insertMention(ref);
    setTrigger(null);
    triggerBlockId.current = null;
  }, []);

  const handleDismiss = useCallback(() => {
    setTrigger(null);
    triggerBlockId.current = null;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).forEach(f => handleImageInsert(f));
  }, [handleImageInsert]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) { e.preventDefault(); files.forEach(f => handleImageInsert(f)); }
  }, [handleImageInsert]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (!doc) return null;

  return (
    <div className="flex flex-col h-full">
      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-6 py-1.5 border-b bg-muted/30 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/40 tracking-wide select-none">
          @ personas · # proyectos · ! eventos · / grupos · arrastra imágenes
        </span>
        <span className="h-4 flex items-center gap-2">
          {uploading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Subiendo imagen...
            </span>
          )}
          {!uploading && status === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Guardando...
            </span>
          )}
          {!uploading && status === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-chart-2 font-medium">
              <CheckCircle2 className="w-3 h-3" /> Guardado
            </span>
          )}
        </span>
      </div>

      {/* ── Collaboration banners ── */}
      {collab.structureLockOwner && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/8 border-b border-primary/15 text-xs text-primary flex-shrink-0">
          <span>✏️ <strong>{collab.structureLockOwner}</strong> está modificando la estructura del documento</span>
        </div>
      )}


      {/* ── Editor surface ── */}
      <div
        className={`flex-1 overflow-y-auto px-6 py-4 transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-inset ring-primary/20' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {doc.blocks.map((block, blockIdx) => {
          if (block.type === 'image') {
            return <ImageBlockEditor key={block.id} block={block} onDelete={handleDeleteImage} />;
          }
          // Compute lock from collab.locks (state, always current in render)
          const lockEntry  = collab.locks[block.id];
          const isLocked   = !!(lockEntry && lockEntry.expiresAt > Date.now());
          const lockedBy   = isLocked ? { userName: lockEntry.userName, userEmail: lockEntry.userEmail } : null;

          let listIndex: number | undefined;
          if (block.type === 'listItem' && block.listType === 'number') {
            let start = blockIdx;
            while (start > 0 && doc.blocks[start - 1].type === 'listItem' && (doc.blocks[start - 1] as ListItemBlock).listType === 'number') {
              start--;
            }
            listIndex = blockIdx - start + 1;
          }

          return (
            <div key={block.id} onFocus={() => { focusedBlockRef.current = block.id; }}>
              <ParagraphEditor
                ref={getParaRef(block.id)}
                block={block}
                onChange={handleBlockChange}
                onEnter={handleEnter}
                onBackspace={handleBackspace}
                onTrigger={state => handleTrigger(block.id, state)}
                onChangeBlockType={handleChangeBlockType}
                listIndex={listIndex}
                autoFocus={focusBlockId === block.id}
                lockedBy={lockedBy}
                isReadOnly={isLocked}
                onFocusBlock={() => collab.acquireBlockLock(block.id)}
                onBlurBlock={() => collab.releaseBlockLock(block.id)}
              />
            </div>
          );
        })}

        {/* Click-to-focus area */}
        <div
          className="min-h-20 cursor-text"
          onClick={() => {
            const blocks = docRef.current?.blocks;
            if (!blocks?.length) return;
            const lastPara = [...blocks].reverse().find(b => b.type !== 'image');
            if (lastPara) paraRefs.current.get(lastPara.id)?.current?.focus();
          }}
        />
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-primary font-medium bg-card/90 px-4 py-2 rounded-xl shadow">Suelta para insertar imagen</p>
          </div>
        )}
      </div>

      <EntityMentionMenu trigger={trigger} onSelect={handleMentionSelect} onDismiss={handleDismiss} />
    </div>
  );
}
