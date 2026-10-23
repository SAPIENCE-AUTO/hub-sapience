import { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { GOLD } from '@/lib/toolColors';
import { MarcaIA } from './comun';

export interface Supuesto { texto: string; donde?: string }

/**
 * Lo que la IA tuvo que decidir, para que nada quede decidido en silencio.
 * Con «Ya lo revisé» se pliega en una línea; si la IA vuelve a decidir algo,
 * se abre otra vez.
 */
export function Supuestos({ items, revisado, onRevisar }: { items: Supuesto[]; revisado: boolean; onRevisar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  if (!items.length) return null;
  const visible = !revisado || abierto;
  return (
    <section className="rounded-xl border bg-white px-4 py-3 shadow-sm" style={{ borderColor: `${GOLD}aa`, backgroundColor: revisado ? undefined : `${GOLD}0d` }}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => revisado && setAbierto((x) => !x)}>
        <MarcaIA />
        <span className="text-sm font-semibold text-[#1F1F23]">Lo que la IA decidió</span>
        <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? 'supuesto' : 'supuestos'}</span>
        {revisado && <span className="ml-auto flex items-center gap-1 text-xs text-[#257E55]"><Check className="h-3.5 w-3.5" />Revisado{abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>}
      </button>
      {visible && (
        <>
          <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {items.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#45454D]">
                <span aria-hidden className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-[#45454D]/60" />
                <span>{s.donde && <span className="font-medium text-[#1F1F23]">{s.donde}: </span>}{s.texto}</span>
              </li>
            ))}
          </ul>
          {!revisado && (
            <button type="button" onClick={onRevisar} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#257E55]/40 bg-white px-2.5 py-1 text-xs font-medium text-[#257E55] hover:bg-[#257E55]/5">
              <Check className="h-3.5 w-3.5" />Ya lo revisé
            </button>
          )}
        </>
      )}
    </section>
  );
}
