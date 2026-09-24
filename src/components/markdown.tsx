import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownProps {
  children: string;
  className?: string;
  // Renderers por elemento (mismo prop de react-markdown) — opcional, para
  // casos como el resumen de Minutas que le pone un ícono a cada ## de
  // sección. Sin esto, se comporta exactamente igual que antes.
  components?: Components;
}

export function Markdown({ children, className, components }: MarkdownProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
