import { useState, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { X, Trash2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { saveDocBlock } from 'zite-endpoints-sdk';
import BlockNoteDocEditor from './docblock/BlockNoteDocEditor';

interface Props {
  open: boolean;
  blockId: string;
  initialTitle: string;
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}

export default function MinutaDialog({ open, blockId, initialTitle, onClose, onTitleChange, onDelete }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [authorName, setAuthorName] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const handleTitleBlur = async () => {
    const trimmed = title.trim() || 'Sin título';
    setTitle(trimmed);
    onTitleChange(trimmed);
    await saveDocBlock({ id: blockId, content: trimmed }).catch(() => {});
  };

  const handleMetaChange = (name: string, at: string) => {
    setAuthorName(name);
    setUpdatedAt(at);
  };

  let relTime = '';
  try {
    if (updatedAt) relTime = formatDistanceToNow(new Date(updatedAt), { addSuffix: true, locale: es });
  } catch { /* skip */ }

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-3xl h-[82vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b bg-card">
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === 'Enter') titleRef.current?.blur(); }}
              className="flex-1 text-base font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 min-w-0"
              placeholder="Sin título"
            />
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <BlockNoteDocEditor blockId={blockId} onMetaChange={handleMetaChange} />
          </div>

          {/* Footer */}
          {(authorName || relTime) && (
            <div className="flex-shrink-0 px-5 py-2 border-t bg-muted/20 text-xs text-muted-foreground/50">
              {authorName && relTime
                ? `Última edición por ${authorName} · ${relTime}`
                : authorName || relTime}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta minuta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente "{title}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmDelete(false); onDelete(); }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
