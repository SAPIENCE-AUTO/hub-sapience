import { useState, useMemo, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';


interface ColumnFilterPopoverProps {
  allValues: string[];
  activeValues: Set<string>;
  onApply: (values: Set<string>) => void;
}

export function ColumnFilterPopover({ allValues, activeValues, onApply }: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Sync pending with activeValues when popover opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setPending(new Set(activeValues)); setSearch(''); } }, [open]);

  const displayed = useMemo(() =>
    search ? allValues.filter(v => v.toLowerCase().includes(search.toLowerCase())) : allValues,
    [allValues, search]
  );

  const allDisplayedSelected = displayed.length > 0 && displayed.every(v => pending.has(v));
  const isActive = activeValues.size > 0;

  const toggle = (v: string) => {
    const next = new Set(pending);
    next.has(v) ? next.delete(v) : next.add(v);
    setPending(next);
  };

  const toggleAll = () => {
    const next = new Set(pending);
    if (allDisplayedSelected) displayed.forEach(v => next.delete(v));
    else displayed.forEach(v => next.add(v));
    setPending(next);
  };

  const apply = () => { onApply(new Set(pending)); setOpen(false); };
  const clear = () => { onApply(new Set()); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative ml-1 p-0.5 rounded hover:bg-muted/80 transition-colors flex-shrink-0 align-middle"
          onClick={e => e.stopPropagation()}
          title="Filtrar columna"
        >
          <Filter className={`w-3 h-3 ${isActive ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'}`} />
          {isActive && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary pointer-events-none" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2 z-50" side="bottom" align="start">
        <Input
          className="h-7 text-xs mb-2"
          placeholder="Buscar valor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <button onClick={toggleAll} className="text-xs text-primary hover:underline font-medium">
            {allDisplayedSelected ? 'Limpiar selección' : 'Seleccionar todos'}
          </button>
          {pending.size > 0 && (
            <span className="text-xs text-muted-foreground">{pending.size} sel.</span>
          )}
        </div>
        <div className="max-h-44 overflow-y-auto">
          <div className="space-y-0.5 pr-1">
            {displayed.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 italic">
                {allValues.length === 0 ? 'Sin valores en esta columna' : 'Sin coincidencias'}
              </p>
            ) : displayed.map(v => (
              <label
                key={v}
                className="flex items-center gap-2 cursor-pointer hover:bg-muted px-1.5 py-1 rounded text-xs font-normal"
              >
                <Checkbox
                  checked={pending.has(v)}
                  onCheckedChange={() => toggle(v)}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                <span className="truncate">{v || '(vacío)'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-border">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={apply}>Aplicar</Button>
          {(pending.size > 0 || activeValues.size > 0) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={clear}>Limpiar</Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
