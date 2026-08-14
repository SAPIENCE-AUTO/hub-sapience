import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList, CommandInput, CommandEmpty } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface ComboboxCreatableProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

/**
 * Select con búsqueda que además permite usar cualquier valor libre que no
 * esté en `options` — para campos como "Cliente" que hoy son texto libre
 * (no una tabla propia), donde queremos autocompletar contra lo ya usado sin
 * bloquear escribir uno nuevo. shouldFilter={false}: se filtra a mano en vez
 * de dejarle el fuzzy-match a cmdk, así el ítem "Crear…" se puede intercalar
 * con certeza sobre cuándo el texto ya existe o no.
 */
export default function ComboboxCreatable({ value, onChange, options, placeholder = 'Seleccionar...', className }: ComboboxCreatableProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = search
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options;
  const exactMatch = options.some(o => o.toLowerCase() === search.trim().toLowerCase());
  const canCreate = search.trim().length > 0 && !exactMatch;

  const select = (v: string) => {
    onChange(v);
    setSearch('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', className)}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar o escribir..." value={search} onValueChange={setSearch} />
          {/* onWheel + stopPropagation: cuando este combobox vive dentro de un
              Dialog (como los de "Nuevo proyecto"/"Editar deal"), el bloqueo
              de scroll del Dialog intercepta la rueda del mouse antes de que
              llegue a esta lista — el scroll programático funciona pero la
              rueda no. Es un choque conocido entre Popover y Dialog de Radix. */}
          <CommandList onWheel={e => e.stopPropagation()}>
            {filtered.length === 0 && !canCreate && <CommandEmpty>Sin resultados</CommandEmpty>}
            <CommandGroup>
              {filtered.map(o => (
                <CommandItem key={o} value={o} onSelect={() => select(o)}>
                  <Check className={cn('w-4 h-4 mr-2', value === o ? 'opacity-100' : 'opacity-0')} />
                  {o}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem value={`__create__${search}`} onSelect={() => select(search.trim())}>
                  <Plus className="w-4 h-4 mr-2" />
                  Crear "{search.trim()}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
