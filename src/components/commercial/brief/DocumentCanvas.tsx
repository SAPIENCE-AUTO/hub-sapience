import { useState, useEffect, useRef, useCallback, createRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';
import { useAuth } from 'zite-auth-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { getDocBlocks, saveDocBlock } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import ParagraphEditor, { ParagraphEditorHandle } from './ParagraphEditor';
import ImageBlockEditor from './ImageBlockEditor';
import EntityMentionMenu from './EntityMentionMenu';
import {
  DocumentModel, ContentBlock, ParagraphBlock, HeadingBlock, ListItemBlock, ImageBlock,
  TriggerState, RefInline, EntityType,
  generateBlockId, makeEmptyDoc, migrateMarkdownToDoc, mergeAdjacentText,
} from './docTypes';
import { useCollaborativeDocument } from '../../../hooks/useCollaborativeDocument';

type SaveStatus = 'idle' | 'saving' | 'saved';

export default function DocumentCanvas({ dealId }: { dealId: string }) {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [doc, setDoc] = useState<DocumentModel | null>(null);
  const [blockDbId, setBlockDbId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastEditedBy, setLastEditedBy] = useState<string | undefined>();
  const [lastEditedAt, setLastEditedAt] = useState<string | undefined>();
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const triggerBlockId  = useRef<string | null>(null);
  const focusedBlockRef = useRef<string | null>(null);
  const docRef          = useRef<DocumentModel | null>(null);
  const blockDbIdRef    = useRef<string | null>(null);
  const opTypeRef       = useRef<'block_update' | 'structure_update'>('block_update');
  const paraRefs        = useRef<Map<string, React.RefObject<ParagraphEditorHandle>>>(new Map());

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { blockDbIdRef.current = blockDbId; }, [blockDbId]);

  const getParaRef = useCallback((id: string) => {
    if (!paraRefs.current.has(id)) paraRefs.current.set(id, createRef<ParagraphEditorHandle>());
    return paraRefs.current.get(id)!;
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getDocBlocks({ dealId });
        if (cancelled) return;
        const block = data.blocks.find(b => b.blockType === 'Texto') ?? data.blocks[0];
        const by = user?.email ?? '';
        if (block) {
          setBlockDbId(block.id);
          blockDbIdRef.current = block.id;
          setLastEditedBy(block.authorName);
          setLastEditedAt(block.updatedAt ?? block.createdAt);
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
            await saveDocBlock({ id: block.id, documentJson: JSON.stringify(migrated) });
          } else {
            const empty = makeEmptyDoc(by);
            setDoc(empty); docRef.current = empty;
          }
        } else {
          const empty = makeEmptyDoc(by);
          const created = await saveDocBlock({ dealId, blockType: 'Texto', sortOrder: 0, content: '', documentJson: JSON.stringify(empty) });
          if (!cancelled) {
            setBlockDbId(created.id); blockDbIdRef.current = created.id;
            setDoc(empty); docRef.current = empty;
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [dealId, user?.email]);

  // ── Reload from DB (reconciliation) ──────────────────────────────────────
  const reloadDocument = useCallback(async () => {
    try {
      const data = await getDocBlocks({ dealId });
      const block = data.blocks.find(b => b.blockType === 'Texto') ?? data.blocks[0];
      if (!block?.documentJson) return;
      const parsed = JSON.parse(block.documentJson) as DocumentModel;
      setDoc(parsed);
      docRef.current = parsed;
      if (block.authorName) setLastEditedBy(block.authorName);
      if (block.updatedAt ?? block.createdAt) setLastEditedAt(block.updatedAt ?? block.createdAt);
    } catch { /* silent */ }
  }, [dealId]);

  // ── Collaboration hook ────────────────────────────────────────────────────
  const collab = useCollaborativeDocument({
    docId: blockDbId,
    setDocument: setDoc,
    docRef,
    myUser: user ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } : undefined,
    onReloadDocument: reloadDocument,
    enabled: !!blockDbId && !!user,
  });

  // ── Debounced save ────────────────────────────────────────────────────────
  const debouncedSave = useDebouncedCallback(async (jsonStr: string) => {
    const id = blockDbIdRef.current;
    if (!id) return;
    setStatus('saving');
    try {
      const result = await saveDocBlock({
        id,
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
      setLastEditedBy(name);
      setLastEditedAt(new Date().toISOString());
      setStatus('saved');
    } catch { setStatus('idle'); }
  }, 1500);

  // ── Image helpers ─────────────────────────────────────────────────────────
  const insertImageBlock = useCallback((url: string) => {
    if (!collab.canModifyStructure()) return;
    opTypeRef.current = 'structure_update';
    const imgBlock: ImageBlock    = { id: generateBlockId(), type: 'image', url };
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

  const handleChipClick = useCallback((refType: EntityType, _refId: string, label: string) => {
    if (refType === 'project')      navigate('/operacion/proyectos');
    else if (refType === 'user')    toast.info(`@${label}`, { description: 'Persona mencionada en este documento' });
    else if (refType === 'event')   toast.info(`!${label}`, { description: 'Evento mencionado en este documento' });
    else if (refType === 'group')   toast.info(`/${label}`, { description: 'Grupo mencionado en este documento' });
  }, [navigate]);

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
  let relTime = '';
  try { if (lastEditedAt) relTime = formatDistanceToNow(new Date(lastEditedAt), { addSuffix: true, locale: es }); } catch { /* skip */ }

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
    <div className="flex flex-col h-full px-6 py-4 gap-3">
      {/* Status bar */}
      <div className="flex items-center justify-between h-5 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/35 tracking-wide select-none">
          @ personas &nbsp;·&nbsp; # proyectos &nbsp;·&nbsp; ! eventos &nbsp;·&nbsp; / grupos &nbsp;·&nbsp; arrastra imágenes
        </span>
        <span className="flex items-center gap-2">
          {uploading && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Subiendo...</span>}
          {!uploading && status === 'saving' && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Guardando...</span>}
          {!uploading && status === 'saved'  && <span className="flex items-center gap-1.5 text-xs text-chart-2 font-medium"><CheckCircle2 className="w-3 h-3" />Guardado</span>}
          {!uploading && status === 'idle' && lastEditedBy && relTime && (
            <span className="text-xs text-muted-foreground/50">
              Editado por <span className="font-medium text-muted-foreground/70">{lastEditedBy}</span> · {relTime}
            </span>
          )}
        </span>
      </div>

      {/* Collaboration banners */}
      {collab.structureLockOwner && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/8 border border-primary/15 rounded-lg text-xs text-primary flex-shrink-0">
          <span>✏️ <strong>{collab.structureLockOwner}</strong> está modificando la estructura del documento</span>
        </div>
      )}


      {/* Document surface */}
      <div
        className={`flex-1 overflow-y-auto relative transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-inset ring-primary/20' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {doc.blocks.map((block, blockIdx) => {
          if (block.type === 'image') {
            return <ImageBlockEditor key={block.id} block={block} onDelete={handleDeleteImage} />;
          }
          const lockEntry = collab.locks[block.id];
          const isLocked  = !!(lockEntry && lockEntry.expiresAt > Date.now());
          const lockedBy  = isLocked ? { userName: lockEntry.userName, userEmail: lockEntry.userEmail } : null;

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
                onChipClick={handleChipClick}
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

        <div
          className="min-h-16 cursor-text"
          onClick={() => {
            const blocks = docRef.current?.blocks;
            if (!blocks?.length) return;
            const lastContent = [...blocks].reverse().find(b => b.type !== 'image');
            if (lastContent) paraRefs.current.get(lastContent.id)?.current?.focus();
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
