import type { PartialBlock } from '@blocknote/core';
import type { DocBlock, DocumentModel, Inline } from '../commercial/brief/docTypes';
import { migrateMarkdownToDoc, makeEmptyDoc } from '../commercial/brief/docTypes';

/**
 * Formato nuevo guardado en document_blocks.documentJson. El backend
 * (saveDocBlock.ts) solo le importa `.version` (chequeo optimista) — el resto
 * es opaco para él, así que este cambio de formato no toca schema ni endpoints.
 */
export interface BlockNoteDoc {
  schemaVersion: 2;
  version: number;
  blocks: PartialBlock[];
}

function isBlockNoteDoc(parsed: unknown): parsed is BlockNoteDoc {
  return !!parsed && typeof parsed === 'object' && (parsed as any).schemaVersion === 2 && Array.isArray((parsed as any).blocks);
}

function convertInline(inline: Inline[]): any[] {
  if (inline.length === 0) return [];
  return inline.map(i => {
    if (i.type === 'ref') {
      return { type: 'reference', props: { refType: i.refType, refId: i.refId, label: i.label } };
    }
    const styles: Record<string, true> = {};
    for (const m of i.marks ?? []) {
      if (m === 'bold') styles.bold = true;
      if (m === 'italic') styles.italic = true;
      if (m === 'strike') styles.strike = true;
      if (m === 'code') styles.code = true;
    }
    return { type: 'text', text: i.text, styles };
  });
}

function convertBlock(b: DocBlock): PartialBlock {
  switch (b.type) {
    case 'heading':
      return { id: b.id, type: 'heading', props: { level: b.level }, content: convertInline(b.content) } as PartialBlock;
    case 'listItem':
      return {
        id: b.id,
        type: b.listType === 'bullet' ? 'bulletListItem' : 'numberedListItem',
        content: convertInline(b.content),
      } as PartialBlock;
    case 'image':
      return { id: b.id, type: 'image', props: { url: b.url, caption: b.alt ?? '' } } as PartialBlock;
    case 'paragraph':
    default:
      return { id: b.id, type: 'paragraph', content: convertInline(b.content) } as PartialBlock;
  }
}

function fromLegacyModel(legacy: DocumentModel): BlockNoteDoc {
  const blocks = legacy.blocks.length > 0
    ? legacy.blocks.map(convertBlock)
    : [{ type: 'paragraph', content: [] } as PartialBlock];
  // Se conserva el número de versión tal cual: el chequeo optimista de
  // saveDocBlock sigue funcionando sobre el mismo contador, no hay que
  // resetearlo a 1 solo porque cambió el formato interno.
  return { schemaVersion: 2, version: typeof legacy.version === 'number' ? legacy.version : 1, blocks };
}

/**
 * Replica la cadena de fallback que ya usan DocumentCanvas.tsx/MinutaEditor.tsx:
 * documentJson (nuevo o viejo) → content en texto plano/markdown → doc vacío.
 * `wasLegacy` indica si hubo que convertir — el llamador debe re-guardar
 * inmediatamente en ese caso (vía saveDocBlock normal) para completar la
 * migración de ese documento sin esperar a que alguien lo edite.
 */
export function parseDocBlockJson(
  documentJson: string | undefined | null,
  plainContent: string | undefined | null,
  updatedBy: string,
): { doc: BlockNoteDoc; wasLegacy: boolean } {
  if (documentJson) {
    let parsed: unknown;
    try { parsed = JSON.parse(documentJson); } catch { parsed = undefined; }
    if (isBlockNoteDoc(parsed)) return { doc: parsed, wasLegacy: false };
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).blocks)) {
      return { doc: fromLegacyModel(parsed as DocumentModel), wasLegacy: true };
    }
  }
  if (plainContent) {
    return { doc: fromLegacyModel(migrateMarkdownToDoc(plainContent, updatedBy)), wasLegacy: true };
  }
  return { doc: fromLegacyModel(makeEmptyDoc(updatedBy)), wasLegacy: true };
}
