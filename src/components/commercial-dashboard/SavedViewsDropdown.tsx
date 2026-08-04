import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ChevronDown, Save, Plus, Pencil, Trash2, Copy, Star } from 'lucide-react';
import { SavedView, DateReference } from '@/lib/commercial-dashboard/types';
import { saveCommercialView, deleteCommercialView } from 'zite-endpoints-sdk';
import { toast } from 'sonner';

interface Props {
  views: SavedView[];
  activeViewId: string | null;
  currentFiltersJson: string;
  currentWidgetsJson: string;
  currentDateRef: DateReference;
  onSelectView: (v: SavedView) => void;
  onViewsChange: (vs: SavedView[]) => void;
}

export default function SavedViewsDropdown({ views, activeViewId, currentFiltersJson, currentWidgetsJson, currentDateRef, onSelectView, onViewsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeView = views.find(v => v.viewId === activeViewId);

  async function saveCurrent() {
    if (!activeView) return;
    setBusy(true);
    try {
      await saveCommercialView({ viewId: activeView.viewId, viewName: activeView.viewName, filtersJson: currentFiltersJson, widgetsJson: currentWidgetsJson, dateReference: currentDateRef, isDefault: activeView.isDefault, isShared: activeView.isShared, sortOrder: activeView.sortOrder });
      onViewsChange(views.map(v => v.viewId === activeView.viewId ? { ...v, filtersJson: currentFiltersJson, widgetsJson: currentWidgetsJson, dateReference: currentDateRef } : v));
      toast.success('Vista guardada');
    } catch { toast.error('Error al guardar'); } finally { setBusy(false); }
  }

  async function saveAs() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await saveCommercialView({ viewName: newName.trim(), filtersJson: currentFiltersJson, widgetsJson: currentWidgetsJson, dateReference: currentDateRef, isDefault: false, isShared: false, sortOrder: views.length });
      const nv: SavedView = { dbId: res.dbId, viewId: res.viewId, viewName: newName.trim(), isDefault: false, isShared: false, filtersJson: currentFiltersJson, widgetsJson: currentWidgetsJson, dateReference: currentDateRef, sortOrder: views.length };
      onViewsChange([...views, nv]);
      onSelectView(nv);
      setNewName(''); setSaveAsOpen(false);
      toast.success('Vista creada');
    } catch { toast.error('Error al crear'); } finally { setBusy(false); }
  }

  async function rename() {
    const v = views.find(x => x.viewId === renameId); if (!v) return;
    try {
      await saveCommercialView({ viewId: v.viewId, viewName: renameVal.trim(), filtersJson: v.filtersJson, widgetsJson: v.widgetsJson, dateReference: v.dateReference, isDefault: v.isDefault, isShared: v.isShared, sortOrder: v.sortOrder });
      onViewsChange(views.map(x => x.viewId === renameId ? { ...x, viewName: renameVal.trim() } : x));
      setRenameId(null); toast.success('Renombrada');
    } catch { toast.error('Error al renombrar'); }
  }

  async function duplicate(v: SavedView) {
    try {
      const res = await saveCommercialView({ viewName: `${v.viewName} (copia)`, filtersJson: v.filtersJson, widgetsJson: v.widgetsJson, dateReference: v.dateReference, isDefault: false, isShared: false, sortOrder: views.length });
      onViewsChange([...views, { ...v, dbId: res.dbId, viewId: res.viewId, viewName: `${v.viewName} (copia)`, isDefault: false }]);
      toast.success('Vista duplicada');
    } catch { toast.error('Error al duplicar'); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteCommercialView({ viewId: deleteId });
      const next = views.filter(v => v.viewId !== deleteId);
      onViewsChange(next);
      if (activeViewId === deleteId && next.length > 0) onSelectView(next[0]);
      setDeleteId(null); toast.success('Vista eliminada');
    } catch { toast.error('Error al eliminar'); }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2 min-w-[160px] justify-between">
            <span className="truncate">{activeView?.viewName ?? 'Sin vista'}</span>
            <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1" align="start">
          {views.length === 0
            ? <p className="text-sm text-muted-foreground text-center py-4">No hay vistas guardadas</p>
            : views.map(v => (
              <div key={v.viewId} className={`flex items-center gap-1 px-2 py-1.5 rounded-md group ${activeViewId === v.viewId ? 'bg-accent' : 'hover:bg-muted'}`}>
                <button className="flex-1 text-sm text-left truncate" onClick={() => { onSelectView(v); setOpen(false); }}>
                  {v.isDefault && <Star className="inline w-3 h-3 mr-1 text-yellow-500 fill-yellow-500" />}{v.viewName}
                </button>
                <div className="hidden group-hover:flex gap-0.5">
                  <button onClick={() => { setRenameId(v.viewId); setRenameVal(v.viewName); }} className="p-1 rounded hover:bg-muted-foreground/20"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => duplicate(v)} className="p-1 rounded hover:bg-muted-foreground/20"><Copy className="w-3 h-3" /></button>
                  <button onClick={() => setDeleteId(v.viewId)} className="p-1 rounded hover:bg-muted-foreground/20 text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))
          }
          {renameId && (
            <div className="p-2 space-y-1.5 border-t mt-1">
              <Input value={renameVal} onChange={e => setRenameVal(e.target.value)} className="h-8 text-sm" onKeyDown={e => e.key === 'Enter' && rename()} />
              <div className="flex gap-1">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={rename}>Guardar</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRenameId(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {activeView && <Button variant="outline" size="sm" className="gap-1.5" onClick={saveCurrent} disabled={busy}><Save className="w-4 h-4" />Guardar</Button>}

      <Popover open={saveAsOpen} onOpenChange={setSaveAsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5"><Plus className="w-4 h-4" />Nueva vista</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 space-y-2" align="end">
          <p className="text-sm font-medium">Guardar como nueva vista</p>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre de la vista" className="h-8 text-sm" onKeyDown={e => e.key === 'Enter' && saveAs()} />
          <Button size="sm" className="w-full" onClick={saveAs} disabled={busy || !newName.trim()}>Crear vista</Button>
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar vista?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
