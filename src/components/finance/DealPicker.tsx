import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { buscarDeals, type DealOpcion } from '@/lib/finance/dealPicker';

// Elegir un deal escribiendo parte del nombre o del cliente (la lista completa es de cientos, en orden alfabético).
export default function DealPicker({ deals, value, onChange, className }: {
  deals: DealOpcion[];
  value: string;
  onChange: (dealId: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const { items, total } = useMemo(() => buscarDeals(deals, texto), [deals, texto]);
  const elegido = deals.find(d => d.id === value);

  return (
    <Popover open={open} onOpenChange={abierto => { setOpen(abierto); if (!abierto) setTexto(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className={cn('justify-between font-normal', className)}>
          <span className="truncate">{elegido ? (elegido.dealName || '(sin nombre)') : 'Busca un deal...'}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nombre del deal o cliente" value={texto} onValueChange={setTexto} />
          <CommandList onWheel={e => e.stopPropagation()}>
            {items.length === 0 && <CommandEmpty>Ningún deal coincide.</CommandEmpty>}
            <CommandGroup>
              {items.map(d => (
                <CommandItem key={d.id} value={d.id} onSelect={() => { onChange(d.id); setOpen(false); }}>
                  <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', d.id === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{d.dealName || '(sin nombre)'}</span>
                  <span className="ml-auto max-w-[45%] shrink-0 truncate pl-3 text-xs text-muted-foreground">{[d.client, d.phase].filter(Boolean).join(' · ')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {total > items.length && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Se muestran {items.length} de {total}. Escribe para acotar.</p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
