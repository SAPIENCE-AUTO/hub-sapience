import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export default function SearchableSelect({ value, onChange, options, placeholder = 'Seleccionar...', className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find(o => o.value === value);
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || o.sub?.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('justify-between font-normal text-xs h-8 min-w-[220px] max-w-[300px]', className)}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-40" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start">
        <div className="p-2 border-b">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
          )}
          {filtered.map(opt => (
            <button
              key={opt.value}
              className={cn(
                'w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 transition-colors',
                value === opt.value && 'bg-accent/70'
              )}
              onClick={() => { onChange(opt.value); setOpen(false); setSearch(''); }}
            >
              <Check className={cn('mt-0.5 h-3 w-3 shrink-0', value === opt.value ? 'opacity-100 text-primary' : 'opacity-0')} />
              <div className="min-w-0">
                <p className="font-medium leading-tight">{opt.label}</p>
                {opt.sub && <p className="text-muted-foreground mt-0.5 truncate">{opt.sub}</p>}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
