import { useState } from 'react';
import { ChevronDown, ChevronRight, FileAudio, FileVideo, File } from 'lucide-react';
import { type ArchivedFile, formatBytes, formatDate, groupBy, mediaKind, subfolder } from './utils';

const ICONS = { video: FileVideo, audio: FileAudio, other: File };

// Lista de archivos agrupada por subcarpeta original de SharePoint. La usan
// la sección del proyecto y cada proyecto dentro de /archivo.
export default function ArchivedFileList({ files, onOpen, defaultOpen = false }: {
  files: ArchivedFile[];
  onOpen: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const groups = groupBy(files, subfolder);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1">
      {groups.map(([folder, items]) => {
        const isOpen = open[folder] ?? (defaultOpen || groups.length === 1);
        const total = items.reduce((s, f) => s + f.sizeBytes, 0);
        return (
          <div key={folder}>
            <button
              onClick={() => setOpen(prev => ({ ...prev, [folder]: !isOpen }))}
              className="w-full flex items-center gap-1.5 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="truncate">{folder}</span>
              <span className="font-normal shrink-0">· {items.length} · {formatBytes(total)}</span>
            </button>
            {isOpen && (
              <div className="space-y-1 pl-5">
                {items.map(f => {
                  const Icon = ICONS[mediaKind(f)];
                  return (
                    <button
                      key={f.id}
                      onClick={() => onOpen(f.id)}
                      className="w-full bg-card border border-border rounded-md px-3 py-2 flex items-center gap-2 text-left hover:border-primary/40 transition-colors"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1 min-w-0">{f.fileName}</span>
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{formatDate(f.originalModifiedAt)}</span>
                      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">{formatBytes(f.sizeBytes)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
