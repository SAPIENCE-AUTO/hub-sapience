import { useState } from 'react';
import { X } from 'lucide-react';
import type { ImageBlock } from './docTypes';

interface Props {
  block: ImageBlock;
  onDelete: (blockId: string) => void;
}

export default function ImageBlockEditor({ block, onDelete }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative my-2 inline-block max-w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={block.url}
        alt={block.alt ?? ''}
        className="max-w-full rounded-lg border border-border object-contain max-h-[480px]"
      />
      {hovered && (
        <button
          onClick={() => onDelete(block.id)}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:opacity-90 transition-opacity"
          title="Eliminar imagen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
