import type { ReactNode } from 'react';
import { Loader2, Sparkles, Square } from 'lucide-react';
import { GOLD, TEAL } from '@/lib/toolColors';

/** Botón principal del moodboard: teal con profundidad suave. */
export const botonTeal = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0F3D4D] px-3 py-1.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(15,61,77,0.35)] transition-colors hover:bg-[#0A303D] disabled:pointer-events-none disabled:opacity-45';
export const botonSecundario = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-[#0F3D4D]/25 bg-white px-3 py-1.5 text-sm font-medium text-[#0F3D4D] transition-colors hover:bg-[#0F3D4D]/5 disabled:pointer-events-none disabled:opacity-45';

/** Marca de lo que hace la IA: chispa dorada sobre teal. */
export function MarcaIA({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <Sparkles className={className} style={{ color: GOLD }} fill={GOLD} strokeWidth={1.5} />;
}

/** Lo que va diciendo la IA mientras trabaja, con el tiempo que lleva y, si se puede, «Detener». */
export function AvanceIA({ pasos, segundos, onDetener }: { pasos: string[]; segundos: number; onDetener?: () => void }) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return (
    <div className="rounded-lg border border-[#0F3D4D]/15 bg-[#0F3D4D]/[0.03] px-3 py-2.5">
      {pasos.slice(0, -1).map((p, i) => <p key={i} className="text-xs text-muted-foreground">✓ {p}</p>)}
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: TEAL }}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {pasos[pasos.length - 1] ?? 'La IA está trabajando…'}
        <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{m}:{String(s).padStart(2, '0')}</span>
        {onDetener && (
          <button type="button" onClick={onDetener} className="flex items-center gap-1 rounded-md border border-[#D32222]/30 bg-white px-2 py-0.5 text-xs font-medium text-[#D32222] hover:bg-[#D32222]/5">
            <Square className="h-3 w-3" fill="currentColor" />Detener
          </button>
        )}
      </p>
    </div>
  );
}

/** Cuántos usos de IA lleva esta hora, contra el tope. */
export function UsoIA({ uso }: { uso?: { usadas: number; limite: number } }) {
  if (!uso) return null;
  const cerca = uso.usadas >= uso.limite * 0.8;
  return (
    <span className="text-[11px] text-muted-foreground" style={cerca ? { color: '#8a4b00' } : undefined} title="Tope de uso de la IA por persona y por hora">
      IA: {uso.usadas} de {uso.limite} esta hora
    </span>
  );
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** Archivo → base64 (sin el prefijo data:). */
export function archivoABase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(archivo);
  });
}
