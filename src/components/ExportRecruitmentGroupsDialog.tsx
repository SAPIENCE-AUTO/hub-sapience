import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Tags } from 'lucide-react';
import { getGroupColor } from './table/tableUtils';
import type { DynCols } from './DynamicColumns';

export const NO_GROUP_KEY = '__no_group__';

export interface ExportGroupOption {
  key: string;
  name: string;
  colorId?: string;
  count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ExportGroupOption[];
  dynCols: DynCols;
  hiddenColumns: Set<string>;
  onConfirm: (selectedKeys: Set<string>) => void;
}

export function ExportRecruitmentGroupsDialog({ open, onOpenChange, groups, dynCols, hiddenColumns, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Mismo criterio de "visible" que usa el export real (RecruitmentPage.tsx) —
  // ordenadas por columnOrder, sin las ocultas.
  const visibleCols = [...dynCols.columns]
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0))
    .filter(c => !hiddenColumns.has(c.id));

  // Al abrir: todos los grupos marcados (exportar "todo" es el caso común) y
  // los inputs de nombre precargados con el alias ya guardado, o el nombre
  // real de la columna si nunca se le puso uno.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(groups.map(g => g.key)));
    const initialLabels: Record<string, string> = {};
    for (const c of visibleCols) initialLabels[c.id] = c.exportLabel || c.columnName || '';
    setLabels(initialLabels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groups]);

  const toggle = (key: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const allSelected = selected.size === groups.length;

  const handleExport = async () => {
    setSaving(true);
    try {
      // Solo guarda las columnas cuyo nombre de exportación de verdad cambió
      // respecto al que ya estaba — evita escrituras de más al exportar sin
      // tocar nada.
      const changed = visibleCols.filter(c => labels[c.id] !== (c.exportLabel || c.columnName || ''));
      await Promise.all(changed.map(c => dynCols.updateColumn(c.id, { exportLabel: (labels[c.id] ?? '').trim() })));
    } catch {
      // El export sigue con lo que ya haya en memoria aunque falle el guardado del alias.
    }
    setSaving(false);
    onConfirm(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar a Excel</DialogTitle>
          <DialogDescription>Elige qué grupos incluir y cómo quieres que se llame cada columna en el archivo.</DialogDescription>
        </DialogHeader>

        {visibleCols.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Tags className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Nombres de columna para el Excel</span>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1.5 border border-border rounded-md p-2">
              {visibleCols.map(c => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <span className="text-xs text-muted-foreground w-28 flex-shrink-0 truncate" title={c.columnName}>{c.columnName}</span>
                  <Input
                    className="h-7 text-sm flex-1"
                    value={labels[c.id] ?? ''}
                    placeholder={c.columnName}
                    onChange={e => setLabels(prev => ({ ...prev, [c.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">{selected.size} de {groups.length} grupos</span>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => setSelected(allSelected ? new Set() : new Set(groups.map(g => g.key)))}
          >
            {allSelected ? 'Ninguno' : 'Seleccionar todos'}
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto space-y-0.5 border border-border rounded-md p-1.5">
          {groups.map(g => (
            <label
              key={g.key}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer"
            >
              <Checkbox checked={selected.has(g.key)} onCheckedChange={() => toggle(g.key)} />
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: g.key === NO_GROUP_KEY ? 'hsl(var(--muted-foreground))' : getGroupColor(g.colorId) }}
              />
              <span className="text-sm flex-1 truncate">{g.name}</span>
              <span className="text-xs text-muted-foreground">{g.count}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button disabled={selected.size === 0 || saving} onClick={handleExport} className="gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Exportar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
