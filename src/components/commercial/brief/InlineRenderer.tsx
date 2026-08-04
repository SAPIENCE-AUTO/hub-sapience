import type { Inline, EntityType } from './docTypes';

interface Props {
  content: Inline[];
  onClickRef?: (refType: EntityType, refId: string) => void;
  className?: string;
}

function renderNode(node: Inline, i: number, onClickRef?: (refType: EntityType, refId: string) => void): React.ReactNode {
  if (node.type === 'ref') {
    const isUser = node.refType === 'user';
    return (
      <span
        key={i}
        contentEditable={false}
        onClick={() => onClickRef?.(node.refType, node.refId)}
        className={`inline-flex items-center px-1.5 py-px rounded text-xs font-medium mx-0.5 cursor-pointer select-none align-baseline whitespace-nowrap border ${
          isUser
            ? 'bg-chart-1/10 text-chart-1 border-chart-1/25'
            : 'bg-chart-2/10 text-chart-2 border-chart-2/25'
        }`}
      >
        {isUser ? '@' : '#'}{node.label}
      </span>
    );
  }
  // TextInline — apply marks
  const marks = node.marks ?? [];
  let content: React.ReactNode = node.text;
  if (marks.includes('code'))   content = <code key="code" className="font-mono text-[0.9em] bg-muted px-1 rounded">{content}</code>;
  if (marks.includes('strike')) content = <s key="s">{content}</s>;
  if (marks.includes('italic')) content = <em key="em">{content}</em>;
  if (marks.includes('bold'))   content = <strong key="strong">{content}</strong>;
  return <span key={i}>{content}</span>;
}

export default function InlineRenderer({ content, onClickRef, className }: Props) {
  if (!content.length) return <span className={className} />;
  return (
    <span className={className}>
      {content.map((node, i) => renderNode(node, i, onClickRef))}
    </span>
  );
}
