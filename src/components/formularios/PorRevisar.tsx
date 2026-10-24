import { useState, type ReactNode } from 'react';
import { Check, CircleDashed } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ALERTA, EXITO, TEAL } from '@/lib/toolColors';
import type { Chequeo } from '@/lib/formularios/listo';

/**
 * «Por revisar»: lo que antes iba en bloques encima del documento (supuestos
 * de la IA, nombres cortos) y en «¿Está listo?», juntos en un chip chico que
 * abre una lista de lado. `detalle` pone, bajo un chequeo, cómo resolverlo
 * ahí mismo (los supuestos con «Ya lo revisé», «Ponerlos con IA»).
 */
export function PorRevisar({ chequeos, detalle }: { chequeos: Chequeo[]; detalle?: Partial<Record<string, ReactNode>> }) {
  const [abierto, setAbierto] = useState(false);
  const faltan = chequeos.filter((c) => !c.ok);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium"
        style={faltan.length
          ? { color: '#8a4b00', borderColor: `${ALERTA}66`, backgroundColor: `${ALERTA}0f` }
          : { color: EXITO, borderColor: `${EXITO}55`, backgroundColor: `${EXITO}0d` }}
      >
        {faltan.length ? <CircleDashed className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        {faltan.length ? `Por revisar · ${faltan.length}` : 'Listo para participantes'}
      </button>
      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent className="w-[440px] max-w-[100vw] overflow-y-auto sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle style={{ color: TEAL }}>Por revisar</SheetTitle>
            <SheetDescription>Lo que conviene resolver antes de abrirlo a participantes. Nada de esto impide probarlo.</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 space-y-3">
            {[...faltan, ...chequeos.filter((c) => c.ok)].map((c) => (
              <li key={c.id} className="text-sm">
                <div className="flex items-start gap-2">
                  {c.ok
                    ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: EXITO }} />
                    : <CircleDashed className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: ALERTA }} />}
                  <span className="min-w-0">
                    <span className={c.ok ? 'text-muted-foreground' : 'font-medium text-[#1F1F23]'}>{c.texto}</span>
                    {!c.ok && c.falta && <span className="block text-xs text-muted-foreground">{c.falta}</span>}
                  </span>
                </div>
                {detalle?.[c.id] && <div className="mt-2 pl-6">{detalle[c.id]}</div>}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
