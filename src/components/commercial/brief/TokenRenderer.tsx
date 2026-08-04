import { Markdown } from '@/components/markdown';

/**
 * Preprocesses [[type:id|label]] tokens into markdown-renderable syntax.
 * [[user:id|Name]]     → <mark>@Name</mark>  (highlighted pill)
 * [[project:code|Name]] → **#Name**           (bold project ref)
 */
function preprocessTokens(markdown: string): string {
  return markdown
    .replace(/\[\[user:[^\|]*\|([^\]]+)\]\]/g, '<mark>@$1</mark>')
    .replace(/\[\[project:[^\|]*\|([^\]]+)\]\]/g, '**#$1**');
}

interface Props {
  content: string;
  className?: string;
}

export default function TokenRenderer({ content, className }: Props) {
  return (
    <Markdown className={className}>
      {preprocessTokens(content)}
    </Markdown>
  );
}
