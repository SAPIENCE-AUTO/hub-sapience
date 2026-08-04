export type Mark = "bold" | "italic" | "strike" | "code";
export type EntityType = "user" | "project" | "event" | "group";

export type TextInline = { type: "text"; text: string; marks?: Mark[] };
export type RefInline = { type: "ref"; refType: EntityType; refId: string; label: string };
export type Inline = TextInline | RefInline;

export type ParagraphBlock = { id: string; type: "paragraph"; content: Inline[] };
export type HeadingBlock   = { id: string; type: "heading";   level: 1 | 2 | 3; content: Inline[] };
export type ListItemBlock  = { id: string; type: "listItem";  listType: "bullet" | "number"; content: Inline[] };
export type ImageBlock     = { id: string; type: "image";     url: string; alt?: string };

export type ContentBlock = ParagraphBlock | HeadingBlock | ListItemBlock;
export type DocBlock     = ContentBlock | ImageBlock;

export type DocumentModel = {
  blocks: DocBlock[];
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type TriggerState = {
  type: 'user' | 'project' | 'event' | 'group';
  query: string;
  rect: DOMRect;
};

export function generateBlockId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function marksEqual(a: Mark[] = [], b: Mark[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((m, i) => m === sb[i]);
}

export function mergeAdjacentText(inlines: Inline[]): Inline[] {
  const result: Inline[] = [];
  for (const node of inlines) {
    const last = result[result.length - 1];
    if (node.type === 'text' && last?.type === 'text' && marksEqual(last.marks, node.marks)) {
      result[result.length - 1] = { ...last, text: last.text + node.text };
    } else {
      result.push(node);
    }
  }
  return result;
}

export function makeEmptyDoc(updatedBy: string): DocumentModel {
  return {
    blocks: [{ id: generateBlockId(), type: 'paragraph', content: [] }],
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function migrateMarkdownToDoc(markdown: string, updatedBy: string): DocumentModel {
  const TOKEN_RE = /\[\[(user|project|event|group):([^\|]+)\|([^\]]+)\]\]/g;
  const lines = markdown.split(/\n+/).filter(l => l.trim().length > 0);

  const blocks: ParagraphBlock[] = lines.map(line => {
    TOKEN_RE.lastIndex = 0;
    const content: Inline[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TOKEN_RE.exec(line)) !== null) {
      if (match.index > lastIndex) {
        content.push({ type: 'text', text: line.slice(lastIndex, match.index) });
      }
      content.push({ type: 'ref', refType: match[1] as EntityType, refId: match[2], label: match[3] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      content.push({ type: 'text', text: line.slice(lastIndex) });
    }
    if (content.length === 0) content.push({ type: 'text', text: line });

    return { id: generateBlockId(), type: 'paragraph', content };
  });

  if (blocks.length === 0) {
    blocks.push({ id: generateBlockId(), type: 'paragraph', content: [] });
  }

  return { blocks, version: 1, updatedAt: new Date().toISOString(), updatedBy };
}
