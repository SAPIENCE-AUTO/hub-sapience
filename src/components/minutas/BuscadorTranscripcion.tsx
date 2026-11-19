import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// La barra de búsqueda de las transcripciones (igual que la de Sharpli): al escribir muestra «2 / 7», flechas para ir a la anterior o a la siguiente
// (Enter y Mayús+Enter también) y una X para limpiar (Esc también).
export default function BuscadorTranscripcion({ value, onChange, total, actual, onAnterior, onSiguiente, onLimpiar }: {
  value: string;
  onChange: (v: string) => void;
  total: number;
  actual: number;
  onAnterior: () => void;
  onSiguiente: () => void;
  onLimpiar: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="relative flex items-center">
        <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onAnterior(); else onSiguiente(); }
            if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); onLimpiar(); }
          }}
          placeholder="Buscar en la transcripción…"
          aria-label="Buscar en la transcripción"
          data-buscador-transcripcion=""
          className="h-8 pl-7 pr-2 text-xs w-56"
        />
      </div>
      {value.trim() && (
        <>
          <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[4.5rem] text-center" aria-live="polite">
            {total > 0 ? `${actual + 1} / ${total}` : 'Sin resultados'}
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onAnterior} disabled={total === 0} aria-label="Coincidencia anterior">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onSiguiente} disabled={total === 0} aria-label="Coincidencia siguiente">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onLimpiar} aria-label="Limpiar búsqueda">
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
