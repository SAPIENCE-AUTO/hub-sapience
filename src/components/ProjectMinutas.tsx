import { useState, useEffect } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Plus, FileText, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getDocBlocks, saveDocBlock, deleteDocBlock } from 'zite-endpoints-sdk';
import { makeEmptyDoc } from './commercial/brief/docTypes';
import MinutaDialog from './MinutaDialog';
import type { GetDocBlocksOutputType } from 'zite-endpoints-sdk';

type BlockItem = GetDocBlocksOutputType['blocks'][0];

interface Minuta {
  id: string;
  title: string;
  authorName: string;
  updatedAt: string;
}

function toMinuta(block: BlockItem): Minuta {
  return {
    id: block.id,
    title: block.content || 'Sin título',
    authorName: block.authorName || '',
    updatedAt: block.updatedAt || block.createdAt || '',
  };
}

function relTime(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es }); } catch { return ''; }
}

interface Props {
  projectCode: string;
}

export default function ProjectMinutas({ projectCode }: Props) {
  const { user } = useAuth();
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!projectCode) return;
    setLoading(true);
    getDocBlocks({ projectCode })
      .then(data => {
        setMinutas(data.blocks.map(toMinuta));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectCode]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const email = user?.email ?? '';
      const emptyDoc = makeEmptyDoc(email);
      const { id } = await saveDocBlock({
        projectCode,
        blockType: 'Minuta',
        sortOrder: 0,
        content: newTitle.trim(),
        documentJson: JSON.stringify(emptyDoc),
      });
      const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || email;
      const newMinuta: Minuta = { id, title: newTitle.trim(), authorName: name, updatedAt: new Date().toISOString() };
      setMinutas(prev => [newMinuta, ...prev]);
      setShowCreate(false);
      setNewTitle('');
      setSelectedId(id);
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDocBlock({ id: deleteTarget });
      setMinutas(prev => prev.filter(m => m.id !== deleteTarget));
      if (selectedId === deleteTarget) setSelectedId(null);
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const selected = minutas.find(m => m.id === selectedId) ?? null;

  return (
    <div className="px-6 py-5">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Minutas y notas</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Documentos del proyecto</p>
        </div>
        <Button size="sm" onClick={() => { setNewTitle(''); setShowCreate(true); }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Nueva minuta
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : minutas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center border border-dashed border-border rounded-xl">
          <FileText className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No hay minutas todavía</p>
          <p className="text-xs text-muted-foreground/60">Crea la primera minuta del proyecto</p>
          <Button size="sm" variant="outline" onClick={() => { setNewTitle(''); setShowCreate(true); }} className="mt-1 gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nueva minuta
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {minutas.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {m.authorName && <span>{m.authorName}</span>}
                  {m.authorName && m.updatedAt && <span className="mx-1">·</span>}
                  {m.updatedAt && <span>{relTime(m.updatedAt)}</span>}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={e => { e.stopPropagation(); setDeleteTarget(m.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </button>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={v => { if (!v) setShowCreate(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva minuta</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Título de la minuta"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newTitle.trim() || creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta minuta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente "{minutas.find(m => m.id === deleteTarget)?.title}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog */}
      {selected && (
        <MinutaDialog
          open={!!selectedId}
          blockId={selected.id}
          initialTitle={selected.title}
          onClose={() => setSelectedId(null)}
          onTitleChange={title => setMinutas(prev => prev.map(m => m.id === selected.id ? { ...m, title } : m))}
          onDelete={() => { setDeleteTarget(selected.id); setSelectedId(null); }}
        />
      )}
    </div>
  );
}
