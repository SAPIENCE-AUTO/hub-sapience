import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Tags } from 'lucide-react';
import { saveBoardColumn } from 'zite-endpoints-sdk';
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
  onConfirm: (selectedGroupKeys: Set<string>, selectedColumnIds: Set<string>, columnLabels: Record<string, string>) => void;
}

export function ExportRecruitmentGroupsDialog({ open, onOpenChange, groups, dynCols, hiddenColumns, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  // Columnas marcadas = van al Excel. Marcar una también abre su input de
  // nombre ahí mismo (Sergio, sep 2026: "que vayamos seleccionando qué
  // columnas van a ir al excel y conforme se van seleccionando, que vaya
  // abriéndose la posibilidad de ponerle nombre") — una sola decisión, no dos
  // listas separadas. Arranca vacío cada vez que se abre (a propósito, por
  // pedido explícito): con tableros de cientos de columnas es mejor construir
  // la exportación eligiendo las que importan que partir de todas marcadas.
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Mismo criterio de "visible" que usa el export real (RecruitmentPage.tsx) —
  // ordenadas por columnOrder, sin las ocultas.
  const visibleCols = [...dynCols.columns]
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0))
    .filter(c => !hiddenColumns.has(c.id));

  // Al abrir: todos los grupos marcados (excluir grupos sigue siendo la
  // excepción), pero ninguna columna — los inputs de nombre se precargan con
  // el alias ya guardado (o el nombre real) por si se marcan, pero no se
  // muestran hasta que el usuario decide incluir esa columna.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(groups.map(g => g.key)));
    setSelectedCols(new Set());
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

  const toggleCol = (colId: string) => setSelectedCols(prev => {
    const n = new Set(prev);
    n.has(colId) ? n.delete(colId) : n.add(colId);
    return n;
  });
  const allColsSelected = visibleCols.length > 0 && selectedCols.size === visibleCols.length;

  const handleExport = async () => {
    setSaving(true);
    // El nombre que de verdad se usa para ESTE export sale de acá directo (lo
    // que hay en los inputs ahora mismo) — no depende de que dynCols.columns
    // ya haya absorbido el guardado antes de que el export arme los
    // encabezados. Esa dependencia era el bug: el guardado y la lectura para
    // el Excel corrían por dos caminos separados (uno vía red, otro vía un
    // estado de React que tarda un render en propagarse), así que a veces el
    // archivo salía con el nombre viejo aunque el guardado sí hubiera
    // funcionado — o al revés.
    const columnLabels: Record<string, string> = {};
    for (const c of visibleCols) {
      if (selectedCols.has(c.id)) columnLabels[c.id] = (labels[c.id] ?? '').trim();
    }
    try {
      // Solo guarda el nombre de las columnas incluidas y cuyo valor de
      // verdad cambió — una columna que se deja fuera de este export NO
      // pierde el nombre que ya tuviera guardado (excluirla de un export no
      // es lo mismo que borrarle el alias).
      const changed = visibleCols.filter(c => selectedCols.has(c.id) && columnLabels[c.id] !== (c.exportLabel || ''));
      if (changed.length > 0) {
        // saveBoardColumn directo (no dynCols.updateColumn): usa los campos
        // de `c`, que ya vienen frescos de este mismo render, en vez de un
        // lookup en el estado interno del hook que podía estar
        // desactualizado si el diálogo llevaba un rato abierto — esa
        // desactualización es lo que a veces hacía que el guardado ni
        // siquiera se disparara.
        await Promise.all(changed.map(c => saveBoardColumn({
          id: c.id,
          columnName: c.columnName ?? '',
          boardId: c.boardId ?? '',
          columnType: c.columnType,
          optionsJson: c.optionsJson,
          columnOrder: c.columnOrder,
          exportLabel: columnLabels[c.id],
        })));
        // Refresca dynCols desde el servidor para que la próxima vez que se
        // abra este diálogo (sin recargar la página) ya se vea el nombre guardado.
        await dynCols.refreshColumns();
      }
    } catch {
      // El export sigue con lo que ya haya en los inputs aunque falle el guardado del alias.
    }
    setSaving(false);
    onConfirm(selected, selectedCols, columnLabels);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar a Excel</DialogTitle>
          <DialogDescription>Elige qué columnas y qué grupos incluir en el archivo.</DialogDescription>
        </DialogHeader>

        {visibleCols.length > 0 && (
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2 px-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Tags className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs font-medium text-muted-foreground truncate">Columnas para el Excel</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground">{selectedCols.size} de {visibleCols.length}</span>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setSelectedCols(allColsSelected ? new Set() : new Set(visibleCols.map(c => c.id)))}
                >
                  {allColsSelected ? 'Ninguna' : 'Todas'}
                </Button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5 border border-border rounded-md p-1.5">
              {visibleCols.map(c => {
                const active = selectedCols.has(c.id);
                return (
                  <div key={c.id} className="rounded-md hover:bg-muted/60">
                    <label className="flex items-center gap-2.5 px-2 py-1.5 cursor-pointer min-w-0">
                      <Checkbox checked={active} onCheckedChange={() => toggleCol(c.id)} className="flex-shrink-0" />
                      <span className="text-sm flex-1 min-w-0 truncate" title={c.columnName}>{c.columnName}</span>
                    </label>
                    {active && (
                      <div className="pl-9 pr-2 pb-1.5 -mt-0.5">
                        <Input
                          className="h-7 text-sm"
                          value={labels[c.id] ?? ''}
                          placeholder={c.columnName}
                          onChange={e => setLabels(prev => ({ ...prev, [c.id]: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
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
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer min-w-0"
            >
              <Checkbox checked={selected.has(g.key)} onCheckedChange={() => toggle(g.key)} className="flex-shrink-0" />
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: g.key === NO_GROUP_KEY ? 'hsl(var(--muted-foreground))' : getGroupColor(g.colorId) }}
              />
              <span className="text-sm flex-1 min-w-0 truncate">{g.name}</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">{g.count}</span>
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
