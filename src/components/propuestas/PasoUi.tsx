import { Loader2 } from 'lucide-react';
import { EXITO, GRIS, INFO, ALERTA, PELIGRO } from '../../lib/toolColors';
import { ESTADOS_PROPUESTA } from '../../lib/propuestasCatalogo';

const COLOR_ESTADO: Record<string, string> = {
  borrador: GRIS, esqueleto: INFO, esqueleto_aprobado: INFO, contenido: ALERTA, revisado: EXITO, construida: EXITO, error: PELIGRO,
};

export function EstadoPill({ estado }: { estado: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: COLOR_ESTADO[estado] ?? GRIS }}>
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {ESTADOS_PROPUESTA[estado] ?? estado}
    </span>
  );
}

// Avance de un paso largo (Claude tarda minutos): lista de lo ya hecho + el
// paso actual con spinner y el tiempo transcurrido, para que no parezca colgado.
export function Progreso({ pasos, segundos }: { pasos: string[]; segundos: number }) {
  const m = Math.floor(segundos / 60), s = segundos % 60;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-1.5">
      {pasos.slice(0, -1).map((p, i) => <p key={i} className="text-xs text-muted-foreground">✓ {p}</p>)}
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        {pasos[pasos.length - 1] ?? 'Trabajando…'}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{m}:{String(s).padStart(2, '0')}</span>
      </p>
    </div>
  );
}

export function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}
