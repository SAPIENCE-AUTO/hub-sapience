import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getGroupColor } from './table/tableUtils';

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
  onConfirm: (selectedKeys: Set<string>) => void;
}

export function ExportRecruitmentGroupsDialog({ open, onOpenChange, groups, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Al abrir, arranca con todos los grupos marcados — exportar "todo" es el
  // caso común, excluir es la excepción.
  useEffect(() => {
    if (open) setSelected(new Set(groups.map(g => g.key)));
  }, [open, groups]);

  const toggle = (key: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const allSelected = selected.size === groups.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar a Excel</DialogTitle>
          <DialogDescription>Elige qué grupos incluir en el archivo.</DialogDescription>
        </DialogHeader>

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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={selected.size === 0} onClick={() => { onConfirm(selected); onOpenChange(false); }}>
            Exportar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
