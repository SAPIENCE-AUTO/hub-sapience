import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface Pestana<T extends string> { id: T; label: string; icon: ComponentType<{ className?: string }> }

const ANCHO_MAS = 76; // lo que ocupa «Más ▾»

/**
 * Las pestañas del proyecto en una sola línea (2026-10-26): en pantallas de
 * 13" bajaban a una segunda línea y le quitaban alto a la información. Las
 * que no caben se van a «Más ▾»; la pestaña abierta siempre se ve.
 */
export function PestanasProyecto<T extends string>({ pestanas, activa, onElegir }: {
  pestanas: Pestana<T>[];
  activa: T;
  onElegir: (id: T) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const medidas = useRef<HTMLDivElement>(null);
  const [caben, setCaben] = useState(pestanas.length);

  useLayoutEffect(() => {
    const calcular = () => {
      if (!caja.current || !medidas.current) return;
      const anchos = [...medidas.current.children].map((el) => (el as HTMLElement).offsetWidth + 4);
      const total = anchos.reduce((a, b) => a + b, 0);
      const disponible = caja.current.offsetWidth;
      if (total <= disponible) { setCaben(pestanas.length); return; }
      let usado = ANCHO_MAS;
      let n = 0;
      while (n < anchos.length && usado + anchos[n] <= disponible) usado += anchos[n++];
      setCaben(n);
    };
    calcular();
    const ro = new ResizeObserver(calcular);
    if (caja.current) ro.observe(caja.current);
    return () => ro.disconnect();
  }, [pestanas]);

  // La abierta siempre a la vista: si cae en «Más», toma el último lugar visible.
  let visibles = pestanas.slice(0, caben);
  const iActiva = pestanas.findIndex((p) => p.id === activa);
  if (iActiva >= caben && caben > 0) visibles = [...pestanas.slice(0, caben - 1), pestanas[iActiva]];
  const enMas = pestanas.filter((p) => !visibles.includes(p));

  const boton = (tab: Pestana<T>, medir = false) => {
    const Icon = tab.icon;
    const on = !medir && activa === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        tabIndex={medir ? -1 : undefined}
        onClick={medir ? undefined : () => onElegir(tab.id)}
        className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
          on ? 'bg-primary font-semibold text-white shadow-sm' : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Icon className={`h-3.5 w-3.5 ${on ? 'text-yellow-400' : ''}`} />
        {tab.label}
      </button>
    );
  };

  // Si no cabe ni una junto a «Más», queda una sola: la abierta, que abre el menú con todas.
  if (caben === 0) {
    const abierta = pestanas.find((p) => p.id === activa) ?? pestanas[0];
    const Icon = abierta?.icon;
    return (
      <div ref={caja} className="relative flex min-w-0 flex-1 basis-full items-center overflow-hidden md:basis-0">
        <div ref={medidas} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-1">
          {pestanas.map((p) => boton(p, true))}
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm">
              {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0 text-yellow-400" />}
              <span className="truncate">{abierta?.label}</span>
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {pestanas.map((p) => {
              const PIcon = p.icon;
              return <DropdownMenuItem key={p.id} onSelect={() => onElegir(p.id)}><PIcon className="mr-2 h-4 w-4" />{p.label}</DropdownMenuItem>;
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div ref={caja} className="relative flex min-w-0 flex-1 basis-full items-center gap-1 overflow-hidden md:basis-0">
      {/* Para medir: las pestañas completas, invisibles. */}
      <div ref={medidas} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-1">
        {pestanas.map((p) => boton(p, true))}
      </div>
      {visibles.map((p) => boton(p))}
      {enMas.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex flex-shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Más <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {enMas.map((p) => {
              const Icon = p.icon;
              return (
                <DropdownMenuItem key={p.id} onSelect={() => onElegir(p.id)}>
                  <Icon className="mr-2 h-4 w-4" />{p.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
