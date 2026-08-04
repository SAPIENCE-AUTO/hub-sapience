import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import type {
  ContentBlock, HeadingBlock, ListItemBlock, Inline, EntityType, RefInline, TriggerState, Mark,
} from './docTypes';
import { mergeAdjacentText } from './docTypes';

export interface ParagraphEditorHandle {
  focus: () => void;
  insertMention: (ref: RefInline) => void;
}

type BlockTypeChange =
  | { type: 'paragraph' }
  | { type: 'heading'; level: 1 | 2 | 3 }
  | { type: 'listItem'; listType: 'bullet' | 'number' };

interface Props {
  block: ContentBlock;
  onChange: (block: ContentBlock) => void;
  onEnter: (afterBlockId: string) => void;
  onBackspace: (blockId: string) => void;
  onTrigger: (state: TriggerState | null) => void;
  onChipClick?: (refType: EntityType, refId: string, label: string) => void;
  onChangeBlockType?: (blockId: string, newType: BlockTypeChange) => void;
  listIndex?: number;
  autoFocus?: boolean;
  // Collaboration
  lockedBy?: { userName: string; userEmail: string } | null;
  isReadOnly?: boolean;
  onFocusBlock?: () => void;
  onBlurBlock?: () => void;
}

// ── Styles ──────────────────────────────────────────────────────────────────

let chipStylesInjected = false;
function injectChipStyles() {
  if (chipStylesInjected || document.getElementById('doc-chip-styles')) return;
  chipStylesInjected = true;
  const s = document.createElement('style');
  s.id = 'doc-chip-styles';
  s.textContent = [
    '.mention-chip{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;font-size:.85em;font-weight:500;cursor:pointer;user-select:none;vertical-align:baseline;margin:0 1px;white-space:nowrap}',
    '.mention-chip-user{background:hsl(var(--chart-1)/.12);color:hsl(var(--chart-1));border:1px solid hsl(var(--chart-1)/.25)}',
    '.mention-chip-project{background:hsl(var(--chart-2)/.12);color:hsl(var(--chart-2));border:1px solid hsl(var(--chart-2)/.25)}',
    '.mention-chip-event{background:hsl(var(--chart-4)/.12);color:hsl(var(--chart-4));border:1px solid hsl(var(--chart-4)/.25)}',
    '.mention-chip-group{background:hsl(var(--chart-5)/.12);color:hsl(var(--chart-5));border:1px solid hsl(var(--chart-5)/.25)}',
    '[data-para]:empty::before{content:attr(data-ph);color:hsl(var(--muted-foreground)/.4);pointer-events:none}',
  ].join('');
  document.head.appendChild(s);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PREFIXES: Record<EntityType, string> = { user: '@', project: '#', event: '!', group: '/' };

function toHTML(content: Inline[]): string {
  return content.map(n => {
    if (n.type === 'ref') {
      return `<span contenteditable="false" data-mention-type="${n.refType}" data-mention-id="${esc(n.refId)}" data-mention-label="${esc(n.label)}" class="mention-chip mention-chip-${n.refType}">${PREFIXES[n.refType] ?? ''}${esc(n.label)}</span>`;
    }
    let html = esc(n.text);
    const marks = n.marks ?? [];
    if (marks.includes('code'))   html = `<code>${html}</code>`;
    if (marks.includes('strike')) html = `<s>${html}</s>`;
    if (marks.includes('italic')) html = `<em>${html}</em>`;
    if (marks.includes('bold'))   html = `<strong>${html}</strong>`;
    return html;
  }).join('');
}

function fromDOMRecursive(node: Node, inherited: Mark[]): Inline[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text) return [];
    const marks = [...inherited].sort() as Mark[];
    return [{ type: 'text', text, ...(marks.length > 0 ? { marks } : {}) }];
  }
  if (!(node instanceof HTMLElement)) return [];
  if (node.dataset.mentionType) {
    return [{ type: 'ref', refType: node.dataset.mentionType as EntityType, refId: node.dataset.mentionId ?? '', label: node.dataset.mentionLabel ?? '' }];
  }
  if (node.tagName === 'BR') {
    const marks = [...inherited].sort() as Mark[];
    return [{ type: 'text', text: '\n', ...(marks.length > 0 ? { marks } : {}) }];
  }
  const marks = [...inherited];
  const tag   = node.tagName.toLowerCase();
  if ((tag === 'strong' || tag === 'b')                  && !marks.includes('bold'))   marks.push('bold');
  if ((tag === 'em'     || tag === 'i')                  && !marks.includes('italic')) marks.push('italic');
  if ((tag === 's' || tag === 'strike' || tag === 'del') && !marks.includes('strike')) marks.push('strike');
  if (tag === 'code'                                     && !marks.includes('code'))   marks.push('code');
  const result: Inline[] = [];
  node.childNodes.forEach(child => result.push(...fromDOMRecursive(child, marks)));
  return result;
}

function fromDOM(el: HTMLElement): Inline[] {
  const result: Inline[] = [];
  el.childNodes.forEach(n => result.push(...fromDOMRecursive(n, [])));
  return mergeAdjacentText(result);
}

function focusAtEnd(el: HTMLElement) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(r);
}

function getContentClass(block: ContentBlock): string {
  const base = 'outline-none py-0.5 break-words w-full';
  if (block.type === 'heading') {
    if (block.level === 1) return `${base} text-2xl font-bold leading-tight`;
    if (block.level === 2) return `${base} text-xl font-bold leading-snug`;
    return `${base} text-lg font-semibold leading-snug`;
  }
  return `${base} text-sm text-foreground leading-relaxed min-h-[1.5em]`;
}

function getPlaceholder(block: ContentBlock): string {
  if (block.type === 'heading')  return `Encabezado ${block.level}`;
  if (block.type === 'listItem') return 'Elemento de lista';
  return 'Escribe aquí...';
}

const TRIGGER_RE = /[@#!/](\w*)$/;
const TRIGGER_CHAR_TO_TYPE: Record<string, TriggerState['type']> = {
  '@': 'user', '#': 'project', '!': 'event', '/': 'group',
};

// ── Toolbar ──────────────────────────────────────────────────────────────────

function TBtn({ children, title, active, onMouseDown, className }: {
  children: React.ReactNode; title: string; active?: boolean;
  onMouseDown: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onMouseDown(); }}
      className={`h-5 min-w-[1.25rem] px-1 rounded text-[11px] font-medium flex items-center justify-center transition-colors
        ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
        ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

function FormatToolbar({ block, onApplyMark, onChangeType }: {
  block: ContentBlock;
  onApplyMark: (cmd: string) => void;
  onChangeType: (t: BlockTypeChange) => void;
}) {
  const isH    = (l: 1 | 2 | 3) => block.type === 'heading'  && (block as HeadingBlock).level === l;
  const isList = (lt: 'bullet' | 'number') => block.type === 'listItem' && (block as ListItemBlock).listType === lt;
  return (
    <div
      className="absolute top-0 left-0 z-10 flex items-center gap-px h-6 px-1 bg-card border border-border/60 rounded-lg shadow-md"
      onMouseDown={e => e.preventDefault()}
    >
      <TBtn title="Negrita (Ctrl+B)"       onMouseDown={() => onApplyMark('bold')}          className="font-bold">B</TBtn>
      <TBtn title="Cursiva (Ctrl+I)"       onMouseDown={() => onApplyMark('italic')}        className="italic">I</TBtn>
      <TBtn title="Tachado (Ctrl+Shift+X)" onMouseDown={() => onApplyMark('strikeThrough')} className="line-through">S</TBtn>
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <TBtn title="Párrafo"      active={block.type === 'paragraph'} onMouseDown={() => onChangeType({ type: 'paragraph' })}>P</TBtn>
      <TBtn title="Encabezado 1" active={isH(1)} onMouseDown={() => onChangeType({ type: 'heading', level: 1 })}>H1</TBtn>
      <TBtn title="Encabezado 2" active={isH(2)} onMouseDown={() => onChangeType({ type: 'heading', level: 2 })}>H2</TBtn>
      <TBtn title="Encabezado 3" active={isH(3)} onMouseDown={() => onChangeType({ type: 'heading', level: 3 })}>H3</TBtn>
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <TBtn title="Lista"          active={isList('bullet')} onMouseDown={() => onChangeType({ type: 'listItem', listType: 'bullet' })}>•</TBtn>
      <TBtn title="Lista numerada" active={isList('number')} onMouseDown={() => onChangeType({ type: 'listItem', listType: 'number' })}>1.</TBtn>
    </div>
  );
}

// ── ParagraphEditor ───────────────────────────────────────────────────────────

const ParagraphEditor = forwardRef<ParagraphEditorHandle, Props>(
  function ParagraphEditor({
    block, onChange, onEnter, onBackspace, onTrigger, onChipClick, onChangeBlockType,
    listIndex, autoFocus,
    lockedBy, isReadOnly = false, onFocusBlock, onBlurBlock,
  }, ref) {
    const divRef   = useRef<HTMLDivElement>(null);
    const hasFocus = useRef(false);
    const [focused, setFocused] = useState(false);
    const cb = useRef({ onChange, onTrigger, onEnter, onBackspace, onChipClick, onChangeBlockType, block });
    cb.current = { onChange, onTrigger, onEnter, onBackspace, onChipClick, onChangeBlockType, block };

    useEffect(() => { injectChipStyles(); }, []);

    useEffect(() => {
      if (!hasFocus.current && divRef.current) {
        divRef.current.innerHTML = toHTML(block.content);
      }
    }, [block]);

    useEffect(() => {
      if (autoFocus && divRef.current) focusAtEnd(divRef.current);
    }, [autoFocus]);

    useImperativeHandle(ref, () => ({
      focus: () => { if (divRef.current) focusAtEnd(divRef.current); },
      insertMention: (mRef: RefInline) => {
        const el = divRef.current;
        if (!el) return;
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        const node  = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;
        const before = (node.textContent ?? '').slice(0, range.startOffset);
        const match  = before.match(TRIGGER_RE);
        if (!match) return;

        const prefix = PREFIXES[mRef.refType] ?? '';
        const span   = document.createElement('span');
        span.setAttribute('contenteditable', 'false');
        span.setAttribute('data-mention-type',  mRef.refType);
        span.setAttribute('data-mention-id',    mRef.refId);
        span.setAttribute('data-mention-label', mRef.label);
        span.className   = `mention-chip mention-chip-${mRef.refType}`;
        span.textContent = prefix + mRef.label;
        const space = document.createTextNode('\u00A0');

        const rng = document.createRange();
        rng.setStart(node, range.startOffset - match[0].length);
        rng.setEnd(node, range.startOffset);
        rng.deleteContents();
        const frag = document.createDocumentFragment();
        frag.appendChild(span);
        frag.appendChild(space);
        rng.insertNode(frag);

        const nr = document.createRange();
        nr.setStartAfter(space);
        nr.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nr);

        cb.current.onChange({ ...cb.current.block, content: fromDOM(el) } as ContentBlock);
        cb.current.onTrigger(null);
      },
    }), []);

    const syncFromDOM = () => {
      const el = divRef.current;
      if (!el) return;
      cb.current.onChange({ ...cb.current.block, content: fromDOM(el) } as ContentBlock);
    };

    const applyMark = (command: string) => {
      document.execCommand(command, false);
      syncFromDOM();
    };

    const changeType = (newType: BlockTypeChange) => {
      syncFromDOM();
      cb.current.onChangeBlockType?.(cb.current.block.id, newType);
    };

    const handleInput = () => {
      syncFromDOM();
      const sel = window.getSelection();
      if (!sel?.rangeCount) { cb.current.onTrigger(null); return; }
      const range = sel.getRangeAt(0);
      const node  = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) { cb.current.onTrigger(null); return; }
      const before = (node.textContent ?? '').slice(0, range.startOffset);
      const match  = before.match(TRIGGER_RE);
      if (!match) { cb.current.onTrigger(null); return; }
      const type = TRIGGER_CHAR_TO_TYPE[match[0][0]];
      if (!type) { cb.current.onTrigger(null); return; }
      const caretRng = range.cloneRange();
      caretRng.collapse(true);
      cb.current.onTrigger({ type, query: match[1], rect: caretRng.getBoundingClientRect() });
    };

    const handleClick = (e: React.MouseEvent) => {
      const chip = (e.target as HTMLElement).closest('.mention-chip') as HTMLElement | null;
      if (!chip) return;
      const refType = chip.dataset.mentionType as EntityType | undefined;
      if (refType) cb.current.onChipClick?.(refType, chip.dataset.mentionId ?? '', chip.dataset.mentionLabel ?? '');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        syncFromDOM();
        cb.current.onEnter(cb.current.block.id);
      } else if (e.key === 'Backspace') {
        const el = divRef.current;
        if (el && (el.textContent ?? '').length === 0) {
          e.preventDefault();
          cb.current.onBackspace(cb.current.block.id);
        }
      } else if (meta && !e.shiftKey && e.key === 'b') {
        e.preventDefault(); e.stopPropagation(); applyMark('bold');
      } else if (meta && !e.shiftKey && e.key === 'i') {
        e.preventDefault(); e.stopPropagation(); applyMark('italic');
      } else if (meta && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault(); e.stopPropagation(); applyMark('strikeThrough');
      }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) return;
      const text = e.clipboardData.getData('text/plain');
      if (text) {
        e.preventDefault();
        document.execCommand('insertText', false, text);
        syncFromDOM();
      }
    };

    const isListItem = block.type === 'listItem';
    const listType   = isListItem ? (block as ListItemBlock).listType : null;

    const editDiv = (
      <div
        ref={divRef}
        contentEditable={!isReadOnly}
        suppressContentEditableWarning
        data-para
        data-ph={getPlaceholder(block)}
        onFocus={() => {
          hasFocus.current = true;
          setFocused(true);
          onFocusBlock?.();
        }}
        onBlur={() => {
          hasFocus.current = false;
          setFocused(false);
          onBlurBlock?.();
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onPaste={handlePaste}
        className={`${getContentClass(block)} ${isReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
      />
    );

    return (
      <div className={`relative ${focused && !isReadOnly ? 'pt-7' : ''} ${lockedBy ? 'border-l-2 border-chart-1 pl-2' : ''}`}>
        {/* Lock badge — shown when another user is editing */}
        {lockedBy && (
          <span className="text-[10px] text-chart-1 font-medium mb-0.5 flex items-center gap-1 select-none">
            <span>✏️</span> {lockedBy.userName} está editando
          </span>
        )}
        {/* Format toolbar — only when focused and not read-only */}
        {focused && !isReadOnly && (
          <FormatToolbar block={block} onApplyMark={applyMark} onChangeType={changeType} />
        )}
        {isListItem ? (
          <div className="flex items-start gap-2">
            <span className="text-sm text-muted-foreground leading-relaxed mt-0.5 select-none w-5 text-right flex-shrink-0">
              {listType === 'bullet' ? '•' : `${listIndex ?? 1}.`}
            </span>
            <div className="flex-1 min-w-0">{editDiv}</div>
          </div>
        ) : editDiv}
      </div>
    );
  }
);

export default ParagraphEditor;
