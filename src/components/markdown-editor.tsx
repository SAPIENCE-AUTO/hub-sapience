import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

interface MarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
  height?: 'dynamic-sm' | 'dynamic-md' | 'dynamic-lg';
  className?: string;
}

const HEIGHT_CLASSES: Record<string, string> = {
  'dynamic-sm': 'min-h-[160px]',
  'dynamic-md': 'min-h-[280px]',
  'dynamic-lg': 'min-h-[420px]',
};

export function MarkdownEditor({ content, onChange, height = 'dynamic-md', className }: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const heightClass = HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES['dynamic-md'];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant={tab === 'write' ? 'secondary' : 'ghost'} onClick={() => setTab('write')}>
          Escribir
        </Button>
        <Button type="button" size="sm" variant={tab === 'preview' ? 'secondary' : 'ghost'} onClick={() => setTab('preview')}>
          Vista previa
        </Button>
      </div>
      {tab === 'write' ? (
        <Textarea
          value={content}
          onChange={e => onChange(e.target.value)}
          className={cn('font-mono text-sm', heightClass)}
        />
      ) : (
        <div className={cn('rounded-md border border-border p-3 overflow-y-auto', heightClass)}>
          <Markdown>{content || '_Sin contenido_'}</Markdown>
        </div>
      )}
    </div>
  );
}
