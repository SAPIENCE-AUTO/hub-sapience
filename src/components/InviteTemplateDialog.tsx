import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Mail, CheckSquare, Square, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { getInviteTemplate, saveInviteTemplate, previewInviteTemplate } from 'zite-endpoints-sdk';

interface Column {
  id: string;
  title: string;
  type?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  calendarName: string;
}

export function InviteTemplateDialog({ open, onOpenChange, boardId, calendarName }: Props) {
  const [loadingCols, setLoadingCols] = useState(false);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !boardId) return;
    setLoadingCols(true);
    getInviteTemplate({ boardId })
      .then(res => {
        setColumns(res.columns);
        setSelectedIds(new Set(res.selectedIds));
      })
      .catch(() => toast.error('Error al cargar las columnas'))
      .finally(() => setLoadingCols(false));
  }, [open, boardId]);

  // Refresca el preview cada vez que cambia la selección u orden — con
  // debounce para no disparar una llamada por cada click mientras alguien
  // reordena rápido con las flechas.
  useEffect(() => {
    if (!open || columns.length === 0) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      setLoadingPreview(true);
      previewInviteTemplate({ boardId, order: columns.map(c => c.id), selected: [...selectedIds] })
        .then(res => setPreviewHtml(res.html))
        .catch(() => { /* preview falla silencioso — no bloquea configurar */ })
        .finally(() => setLoadingPreview(false));
    }, 350);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [open, boardId, columns, selectedIds]);

  // ── Selection ──────────────────────────────────────────────────────────
  const toggleAll = () => {
    if (selectedIds.size === columns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(columns.map(c => c.id)));
    }
  };

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Reorder ────────────────────────────────────────────────────────────
  const moveUp = (index: number) => {
    if (index === 0) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  // ── Save ───────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setSaving(true);
    try {
      await saveInviteTemplate({ boardId, order: columns.map(c => c.id), selected: [...selectedIds] });
      toast.success('Plantilla de invitación guardada');
      onOpenChange(false);
    } catch {
      toast.error('Error al guardar la plantilla');
    } finally {
      setSaving(false);
    }
  };

  const allSelected = columns.length > 0 && selectedIds.size === columns.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < columns.length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4 text-primary" />
            Configurar invitación — {calendarName}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[minmax(240px,320px)_1fr] gap-4">
          {/* Left: column picker */}
          <div className="space-y-2 min-w-0">
            <p className="text-xs text-muted-foreground">
              Selecciona y ordena las columnas que se muestran en el correo de invitación de este calendario.
            </p>

            {loadingCols ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : columns.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-4">Este calendario todavía no tiene columnas.</p>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 bg-muted/50 hover:bg-muted transition-colors border-b border-border text-left"
                  onClick={toggleAll}
                >
                  {allSelected
                    ? <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                    : someSelected
                      ? <div className="w-4 h-4 rounded border-2 border-primary bg-primary/20 flex-shrink-0" />
                      : <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <span className="text-xs font-semibold text-foreground">
                    {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {selectedIds.size}/{columns.length}
                  </span>
                </button>

                <div className="max-h-[65vh] overflow-y-auto divide-y divide-border/50">
                  {columns.map((col, index) => (
                    <div key={col.id} className="flex items-center gap-2 px-2 py-2 hover:bg-muted/30 transition-colors">
                      <div className="flex flex-col flex-shrink-0">
                        <button
                          onClick={() => moveUp(index)}
                          disabled={index === 0}
                          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => moveDown(index)}
                          disabled={index === columns.length - 1}
                          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>

                      <span className="text-[10px] text-muted-foreground/50 tabular-nums w-4 text-right flex-shrink-0">
                        {index + 1}
                      </span>

                      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                        <Checkbox
                          checked={selectedIds.has(col.id)}
                          onCheckedChange={() => toggle(col.id)}
                          className="h-3.5 w-3.5 flex-shrink-0"
                        />
                        <span className={`text-sm flex-1 truncate ${selectedIds.has(col.id) ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {col.title}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">Vista previa</p>
              {loadingPreview && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            </div>
            <iframe
              sandbox=""
              srcDoc={previewHtml}
              title="Vista previa del invite"
              className="w-full h-[65vh] rounded-md border border-border bg-white"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleApply} disabled={saving || loadingCols} className="gap-1.5">
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando...</>
              : <><Mail className="w-3.5 h-3.5" /> Aplicar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
