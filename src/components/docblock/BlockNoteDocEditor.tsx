import { useState, useEffect, useRef, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useAuth } from 'zite-auth-sdk';
import { toast } from 'sonner';
import { uploadFile as uploadFileToStorage } from 'zite-file-upload-sdk';
import { getDocBlocks, getDocBlock, saveDocBlock } from 'zite-endpoints-sdk';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { docSchema } from './docSchema';
import DocToolbar from './DocToolbar';
import ReferenceSuggestionMenus from './ReferenceSuggestionMenus';
import { parseDocBlockJson, type BlockNoteDoc } from './legacyConverter';
import { useCollaborativeDocument } from '../../hooks/useCollaborativeDocument';

type SaveStatus = 'idle' | 'saving' | 'saved';
type Editor = typeof docSchema.BlockNoteEditor;

interface Props {
  dealId?: string;
  blockId?: string;
  onMetaChange?: (authorName: string, updatedAt: string) => void;
  /** false para documentos privados de un solo usuario (ej. notas de un
   *  pendiente personal) — apaga por completo el canal de tiempo real
   *  (SSE, heartbeats, locks por bloque). Default true: preserva el
   *  comportamiento de siempre para minutas y demás documentos compartidos. */
  collaborative?: boolean;
}

interface Resolved {
  blockDbId: string;
  doc: BlockNoteDoc;
}

/**
 * Reemplaza tanto a DocumentCanvas.tsx (prop dealId) como a MinutaEditor.tsx
 * (prop blockId) — ver plan de migración. Solo uno de los dos props debe
 * pasarse.
 */
export default function BlockNoteDocEditor({ dealId, blockId, onMetaChange, collaborative = true }: Props) {
  const { user } = useAuth();
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastEditedBy, setLastEditedBy] = useState<string | undefined>();
  const [lastEditedAt, setLastEditedAt] = useState<string | undefined>();
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;

  const reportMeta = useCallback((authorName?: string, updatedAt?: string) => {
    if (authorName) setLastEditedBy(authorName);
    if (updatedAt) setLastEditedAt(updatedAt);
    if (authorName && updatedAt) onMetaChangeRef.current?.(authorName, updatedAt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const by = user?.email ?? '';
      if (blockId) {
        const { block } = await getDocBlock({ id: blockId });
        if (cancelled || !block) return;
        const { doc, wasLegacy } = parseDocBlockJson(block.documentJson, block.content, by);
        if (block.authorName) reportMeta(block.authorName, block.updatedAt ?? block.createdAt);
        if (wasLegacy) {
          const r = await saveDocBlock({ id: blockId, documentJson: JSON.stringify(doc), expectedVersion: doc.version });
          if (r.savedVersion !== undefined) doc.version = r.savedVersion;
        }
        if (!cancelled) setResolved({ blockDbId: blockId, doc });
      } else if (dealId) {
        const data = await getDocBlocks({ dealId });
        const block = data.blocks.find(b => b.blockType === 'Texto') ?? data.blocks[0];
        if (cancelled) return;
        if (block) {
          const { doc, wasLegacy } = parseDocBlockJson(block.documentJson, block.content, by);
          reportMeta(block.authorName, block.updatedAt ?? block.createdAt);
          if (wasLegacy) {
            const r = await saveDocBlock({ id: block.id, documentJson: JSON.stringify(doc), expectedVersion: doc.version });
            if (r.savedVersion !== undefined) doc.version = r.savedVersion;
          }
          if (!cancelled) setResolved({ blockDbId: block.id, doc });
        } else {
          const empty: BlockNoteDoc = { schemaVersion: 2, version: 1, blocks: [{ type: 'paragraph', content: [] }] };
          const created = await saveDocBlock({ dealId, blockType: 'Texto', sortOrder: 0, content: '', documentJson: JSON.stringify(empty) });
          if (!cancelled) setResolved({ blockDbId: created.id, doc: empty });
        }
      }
    };
    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, blockId, user?.email]);

  if (loading) {
    return (
      <div className="p-6 space-y-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (!resolved) return null;

  return (
    <DocEditorInner
      key={resolved.blockDbId}
      blockDbId={resolved.blockDbId}
      initialDoc={resolved.doc}
      lastEditedBy={lastEditedBy}
      lastEditedAt={lastEditedAt}
      showOwnMetaLine={!onMetaChange}
      onMeta={reportMeta}
      collaborative={collaborative}
    />
  );
}

interface InnerProps {
  blockDbId: string;
  initialDoc: BlockNoteDoc;
  lastEditedBy?: string;
  lastEditedAt?: string;
  showOwnMetaLine: boolean;
  onMeta: (authorName?: string, updatedAt?: string) => void;
  collaborative: boolean;
}

function DocEditorInner({ blockDbId, initialDoc, lastEditedBy, lastEditedAt, showOwnMetaLine, onMeta, collaborative }: InnerProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [uploading, setUploading] = useState(false);

  const versionRef = useRef(initialDoc.version);
  const opTypeRef = useRef<'block_update' | 'structure_update'>('block_update');
  const focusedBlockRef = useRef<string | null>(null);
  const lockedBlockRef = useRef<string | null>(null);
  const lastWarnRef = useRef<string | null>(null);

  const editor = useCreateBlockNote({
    schema: docSchema,
    initialContent: initialDoc.blocks.length > 0 ? (initialDoc.blocks as any) : undefined,
    uploadFile: async (file: File) => {
      setUploading(true);
      try {
        const res = await uploadFileToStorage({ data: file, filename: file.name });
        return res.fileUrl;
      } finally {
        setUploading(false);
      }
    },
  });

  // ── Reload from DB (reconciliation tras structure_update remoto o conflicto) ──
  const reloadDocument = useCallback(async () => {
    try {
      const { block } = await getDocBlock({ id: blockDbId });
      if (!block?.documentJson) return;
      const { doc } = parseDocBlockJson(block.documentJson, block.content, user?.email ?? '');
      versionRef.current = doc.version;
      editor.replaceBlocks(editor.document, doc.blocks as any);
      onMeta(block.authorName, block.updatedAt ?? block.createdAt);
    } catch { /* silent */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockDbId, editor, user?.email]);

  // ── Aplicar block_update remoto imperativamente (editor no controlado por React) ──
  const handleRemoteBlockUpdate = useCallback((remoteBlockId: string, block: any, docVersion?: number) => {
    try { editor.updateBlock(remoteBlockId, block); } catch { /* el bloque ya no existe — un reload ya viene en camino si hubo structure_update */ }
    if (typeof docVersion === 'number') versionRef.current = docVersion;
  }, [editor]);

  const collab = useCollaborativeDocument({
    docId: blockDbId,
    onRemoteBlockUpdate: handleRemoteBlockUpdate,
    myUser: user ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } : undefined,
    onReloadDocument: reloadDocument,
    enabled: collaborative && !!user,
  });

  // ── Autosave debounced ────────────────────────────────────────────────────
  const debouncedSave = useDebouncedCallback(async () => {
    setStatus('saving');
    try {
      const doc: BlockNoteDoc = { schemaVersion: 2, version: versionRef.current, blocks: editor.document };
      const result = await saveDocBlock({
        id: blockDbId,
        documentJson: JSON.stringify(doc),
        expectedVersion: versionRef.current,
        changedBlockId: opTypeRef.current === 'block_update' ? (focusedBlockRef.current ?? undefined) : undefined,
        operationType: opTypeRef.current,
      });
      if (result.conflict) { setStatus('idle'); reloadDocument().catch(() => {}); return; }
      if (result.savedVersion !== undefined) versionRef.current = result.savedVersion;
      const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || 'tú';
      onMeta(name, new Date().toISOString());
      setStatus('saved');
    } catch { setStatus('idle'); }
  }, 1500);

  // ── Detectar block_update vs structure_update por transacción ────────────
  useEffect(() => {
    return editor.onChange((_ed, { getChanges }) => {
      const changes = getChanges();
      if (changes.length === 0) return;
      const uniqueIds = new Set(changes.map(c => c.block.id));
      if (uniqueIds.size === 1 && changes.every(c => c.type === 'update')) {
        opTypeRef.current = 'block_update';
        focusedBlockRef.current = [...uniqueIds][0];
      } else {
        opTypeRef.current = 'structure_update';
      }
      setStatus('idle');
      debouncedSave();
    }, false); // false: no reaccionar a cambios aplicados por handleRemoteBlockUpdate — si no, se re-guardaría en bucle lo que otro usuario ya guardó
  }, [editor, debouncedSave]);

  // ── El lock de bloque sigue al cursor (reemplaza onFocusBlock/onBlurBlock por-ParagraphEditor) ──
  // Nota: acquireBlockLock/releaseBlockLock no se apagan solos con
  // collab.enabled=false (siguen llamando a publishDocEvent) — para un
  // documento no-colaborativo hay que saltarse el efecto entero, si no
  // se sigue pagando una llamada de red por cada cambio de cursor.
  useEffect(() => {
    if (!collaborative) return;
    return editor.onSelectionChange(() => {
      let id: string;
      try { id = editor.getTextCursorPosition().block.id; } catch { return; }
      if (lockedBlockRef.current === id) return;
      if (lockedBlockRef.current) collab.releaseBlockLock(lockedBlockRef.current);
      lockedBlockRef.current = id;
      collab.acquireBlockLock(id);
      const info = collab.getBlockLockInfo(id);
      if (info && lastWarnRef.current !== info.userName) {
        lastWarnRef.current = info.userName;
        toast.warning(`${info.userName} está editando este bloque ahora mismo`);
        setTimeout(() => { lastWarnRef.current = null; }, 4000);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, collaborative]);

  let relTime = '';
  try { if (lastEditedAt) relTime = formatDistanceToNow(new Date(lastEditedAt), { addSuffix: true, locale: es }); } catch { /* skip */ }

  return (
    <div className="flex flex-col h-full">
      <DocToolbar editor={editor} />
      <div className="flex items-center justify-between px-4 py-1 border-b bg-muted/20 flex-shrink-0 text-[10px] text-muted-foreground">
        <span className="tracking-wide select-none">@ personas &nbsp;·&nbsp; # proyectos &nbsp;·&nbsp; ! eventos &nbsp;·&nbsp; &amp; grupos &nbsp;·&nbsp; / insertar bloque &nbsp;·&nbsp; arrastra imágenes</span>
        <span className="flex items-center gap-2">
          {uploading && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Subiendo...</span>}
          {!uploading && status === 'saving' && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Guardando...</span>}
          {!uploading && status === 'saved' && <span className="flex items-center gap-1 text-chart-2 font-medium"><CheckCircle2 className="w-3 h-3" /> Guardado</span>}
          {showOwnMetaLine && !uploading && status === 'idle' && lastEditedBy && relTime && (
            <span>Editado por <span className="font-medium">{lastEditedBy}</span> · {relTime}</span>
          )}
        </span>
      </div>
      {collab.structureLockOwner && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/8 border-b border-primary/15 text-xs text-primary flex-shrink-0">
          <span>✏️ <strong>{collab.structureLockOwner}</strong> está modificando la estructura del documento</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <BlockNoteView editor={editor} theme="light" formattingToolbar={false}>
          <ReferenceSuggestionMenus editor={editor} />
        </BlockNoteView>
      </div>
    </div>
  );
}

// Nota de alcance: el aviso de arriba (lastWarnRef) es informativo, no
// bloquea la edición como sí lo hacía isReadOnly por-bloque en el editor
// viejo — BlockNote no expone fácil un "solo este nodo es readonly". Ver
// riesgo documentado en el plan de migración; a probar en el stress-test de
// 2 pestañas antes de dar por buena esta fase.
