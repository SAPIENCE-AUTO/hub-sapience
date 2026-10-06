import { useState } from 'react';
import { ChevronDown, ChevronRight, FileAudio, FileVideo, File, Share2 } from 'lucide-react';
import type { ScopeToShare } from './ShareScopeDialog';
import { type ArchivedFile, dirPath, displayFolder, formatBytes, formatDate, groupBy, mediaKind } from './utils';

const ICONS = { video: FileVideo, audio: FileAudio, other: File };

// Lista de archivos agrupada por subcarpeta original de SharePoint. La usan
// la sección del proyecto y cada proyecto dentro de /archivo.
export default function ArchivedFileList({ files, onOpen, onShare, defaultOpen = false }: {
  files: ArchivedFile[];
  onOpen: (id: string) => void;
  onShare?: (target: ScopeToShare) => void;
  defaultOpen?: boolean;
}) {
  const groups = groupBy(files, dirPath);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1">
      {groups.map(([folder, items]) => {
        const isOpen = open[folder] ?? (defaultOpen || groups.length === 1);
        const total = items.reduce((s, f) => s + f.sizeBytes, 0);
        return (
          <div key={folder}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOpen(prev => ({ ...prev, [folder]: !isOpen }))}
                className="flex-1 min-w-0 flex items-center gap-1.5 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{displayFolder(folder)}</span>
                <span className="font-normal shrink-0">· {items.length} · {formatBytes(total)}</span>
              </button>
              {onShare && folder.includes('/') && (
                <button
                  onClick={() => onShare({ scope: 'folder', pathPrefix: folder, label: folder.split('/').pop()!, fileCount: items.length })}
                  className="text-muted-foreground hover:text-primary p-1 shrink-0"
                  title="Compartir esta carpeta con cliente"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
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
