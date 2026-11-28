import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { filtrarOpciones, type OpcionBuscable } from '@/lib/pagosManagement/buscador';

export interface GrupoOpciones { titulo?: string; opciones: OpcionBuscable[] }

/** Cuántas opciones se dibujan a la vez en cada grupo: la lista de deals son cientos y escribir las acota. */
const LIMITE_POR_GRUPO = 100;

/**
 * Una lista desplegable donde se puede ESCRIBIR para buscar (en lugar de recorrer la lista completa): para elegir una persona o un deal en el reparto de Pagos de
 * management. Hace lo mismo que un `<select>` (un valor elegido, opciones agrupadas, algunas deshabilitadas) más una caja de búsqueda; la búsqueda ignora acentos y
 * mayúsculas y pide todas las palabras escritas (lib/pagosManagement/buscador.ts). Las `acciones` se ven siempre al final (por ejemplo «Otra persona externa…») y
 * `alAgregarEscrito` ofrece, cuando lo escrito no coincide con nadie, agregarlo tal cual.
 */
export function BuscadorSelect({
  id, etiqueta, valor, textoElegido, placeholder, placeholderBusqueda, sinResultados, grupos, acciones, alAgregarEscrito, onElegir, className, anchoLista = 'w-80',
}: {
  id?: string;
  /** Nombre accesible del botón. */
  etiqueta: string;
  /** El valor elegido; '' = ninguno (se ve el `placeholder`). */
  valor: string;
  /** Lo que se ve en el botón cuando hay algo elegido (por omisión, el valor). */
  textoElegido?: string;
  placeholder: string;
  placeholderBusqueda: string;
  sinResultados: string;
  grupos: GrupoOpciones[];
  acciones?: Array<{ valor: string; texto: string }>;
  /** Lo que se ofrece cuando lo escrito no coincide con ninguna opción: `texto` es el renglón y `alElegir` recibe lo escrito. */
  alAgregarEscrito?: { texto: (escrito: string) => string; alElegir: (escrito: string) => void };
  onElegir: (valor: string) => void;
  className?: string;
  /** Ancho de la lista desplegada (clase de Tailwind). */
  anchoLista?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const filtrados = useMemo(() => grupos.map((g) => ({ titulo: g.titulo, ...filtrarOpciones(g.opciones, texto, LIMITE_POR_GRUPO) })), [grupos, texto]);
  const hayResultados = filtrados.some((g) => g.items.length > 0);
  const escrito = texto.trim();
  const ofrecerEscrito = !!alAgregarEscrito && escrito !== '' && !hayResultados;

  const elegir = (v: string) => { onElegir(v); setAbierto(false); };

  return (
    <Popover open={abierto} onOpenChange={(a) => { setAbierto(a); if (!a) setTexto(''); }}>
      <PopoverTrigger asChild>
        <Button
          id={id} type="button" variant="outline" role="combobox" aria-expanded={abierto} aria-label={etiqueta}
          className={cn('h-9 w-full justify-between px-2.5 font-normal', className)}
        >
          <span className={cn('truncate', !valor && 'text-muted-foreground')}>{valor ? (textoElegido ?? valor) : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', anchoLista)} align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholderBusqueda} value={texto} onValueChange={setTexto} />
          <CommandList onWheel={(e) => e.stopPropagation()}>
            {!hayResultados && !ofrecerEscrito && <p className="px-3 py-3 text-center text-sm text-muted-foreground">{sinResultados}</p>}
            {filtrados.map((g, gi) => g.items.length > 0 && (
              <CommandGroup key={g.titulo ?? gi} heading={g.titulo}>
                {g.items.map((o) => (
                  <CommandItem key={o.valor} value={`${gi}:${o.valor}`} disabled={o.deshabilitada} onSelect={() => elegir(o.valor)}>
                    <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', o.valor === valor ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{o.texto}</span>
                    {o.extra && <span className="ml-auto max-w-[45%] shrink-0 truncate pl-3 text-xs text-muted-foreground">{o.extra}</span>}
                  </CommandItem>
                ))}
                {g.total > g.items.length && (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">Se muestran {g.items.length} de {g.total}. Escribe para acotar.</p>
                )}
              </CommandGroup>
            ))}
            {ofrecerEscrito && alAgregarEscrito && (
              <CommandGroup>
                <CommandItem value="__escrito__" onSelect={() => { alAgregarEscrito.alElegir(escrito); setAbierto(false); }}>
                  <span className="truncate">{alAgregarEscrito.texto(escrito)}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {acciones && acciones.length > 0 && (
              <>
                {(hayResultados || ofrecerEscrito) && <CommandSeparator />}
                <CommandGroup>
                  {acciones.map((a) => (
                    <CommandItem key={a.valor} value={`accion:${a.valor}`} onSelect={() => elegir(a.valor)}>
                      <span className="truncate">{a.texto}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
