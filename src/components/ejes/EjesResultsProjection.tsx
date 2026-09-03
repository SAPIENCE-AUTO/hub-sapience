import { X, Crosshair } from 'lucide-react';
import EjesQuadrantChart, { type EjesIdeaResultado } from './EjesQuadrantChart';
import { TEAL, INFO } from '@/lib/toolColors';

export interface ResultadoTablero {
  tableroId: string;
  tableroNombre: string;
  ejeXLabel: string; ejeXMin: number; ejeXMax: number;
  ejeYLabel: string; ejeYMin: number; ejeYMax: number;
  totalParticipantesEvaluaron: number;
  ideas: EjesIdeaResultado[];
}

interface EjesResultsProjectionProps {
  sesionNombre: string;
  cliente?: string;
  tableros: ResultadoTablero[];
  onClose: () => void;
}

/**
 * Modo proyección — pantalla completa, sin controles de edición, para
 * compartir/proyectar frente al cliente. Mismo lenguaje visual que el resto
 * del Hub (header con tinte teal + badge, stats en teal/mono, cards con
 * franja de acento) en vez del navy oscuro que usaba antes — el punto
 * central de esta vista es leer bien el mapa, no la ambientación oscura.
 * Acepta uno o varios tableros a la vez (la vista de un solo tablero le
 * manda un array de longitud 1), cada uno con su propio mapa (los
 * ejes/escalas no se mezclan entre tableros distintos).
 */
export default function EjesResultsProjection({ sesionNombre, cliente, tableros, onClose }: EjesResultsProjectionProps) {
  const ideasEvaluadas = tableros.reduce((sum, t) => sum + t.ideas.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#F7FAFA]">
      <div className="pointer-events-none absolute -right-40 -top-44 h-[460px] w-[460px] rounded-full border-[64px] border-[rgba(15,61,77,0.05)]" />
      <div className="pointer-events-none absolute -bottom-36 -left-32 h-[380px] w-[380px] rounded-full border-[48px] border-[rgba(244,192,37,0.07)]" />

      <div
        className="relative flex flex-shrink-0 items-center justify-between gap-6 border-b border-border px-10 py-8"
        style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${TEAL} 7%, white) 0%, #F7FAFA 100%)` }}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-2xl shadow-[0_8px_20px_-6px_rgba(15,61,77,0.45)]" style={{ backgroundColor: TEAL }}>
            <Crosshair className="h-6 w-6 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70" style={{ color: TEAL }}>Sapience · Ejes</p>
            <h1 className="mt-0.5 truncate text-[30px] font-extrabold leading-[1.15] tracking-tight" style={{ color: TEAL }}>{sesionNombre}</h1>
            {cliente && <p className="mt-0.5 text-sm text-muted-foreground">{cliente}</p>}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors"
          style={{ backgroundColor: `color-mix(in srgb, ${TEAL} 8%, white)`, color: TEAL }}
          aria-label="Cerrar"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="relative mx-auto flex w-full max-w-4xl gap-10 px-10 pb-2 pt-6">
        <Stat value={tableros.length} label={`tablero${tableros.length !== 1 ? 's' : ''}`} />
        <Stat value={ideasEvaluadas} label={`idea${ideasEvaluadas !== 1 ? 's' : ''} evaluada${ideasEvaluadas !== 1 ? 's' : ''}`} />
      </div>

      <div className="relative mx-auto w-full max-w-4xl flex-1 space-y-8 px-6 pb-16 pt-6">
        {tableros.map((tab) => (
          <section key={tab.tableroId} className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(16,45,54,0.04),0_12px_32px_-20px_rgba(16,45,54,0.18)]">
            <div className="relative flex items-center justify-between gap-3 border-b border-border py-4 pl-6 pr-5">
              <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: TEAL }} />
              <h2 className="text-[16px] font-bold text-foreground">{tab.tableroNombre}</h2>
              <span
                className="flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: `color-mix(in srgb, ${INFO} 10%, white)`, color: INFO }}
              >
                {tab.totalParticipantesEvaluaron} participante{tab.totalParticipantesEvaluaron !== 1 ? 's' : ''}
              </span>
            </div>
            {tab.ideas.length === 0 ? (
              <p className="px-6 py-8 text-[15px] text-muted-foreground">Todavía no hay evaluaciones que mostrar.</p>
            ) : (
              <>
                <div className="px-5 pt-4">
                  <EjesQuadrantChart
                    ejeXLabel={tab.ejeXLabel} ejeXMin={tab.ejeXMin} ejeXMax={tab.ejeXMax}
                    ejeYLabel={tab.ejeYLabel} ejeYMin={tab.ejeYMin} ejeYMax={tab.ejeYMax}
                    ideas={tab.ideas}
                    height={420}
                    dotColor={TEAL}
                  />
                </div>
                <p className="px-6 pb-4 pt-1 text-xs text-muted-foreground">
                  El tamaño de cada punto es proporcional al número de evaluaciones que recibió esa idea.
                </p>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[22px] font-bold tabular-nums" style={{ color: TEAL }}>{value}</span>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
    </div>
  );
}
