import { X } from 'lucide-react';
import EjesQuadrantChart, { type EjesIdeaResultado } from './EjesQuadrantChart';

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
 * Modo proyección (mismo tratamiento navy/teal que SwipeResultsProjection.tsx)
 * — pantalla completa, sin controles de edición, para compartir/proyectar
 * frente al cliente. Acepta uno o varios tableros a la vez (la vista de un
 * solo tablero le manda un array de longitud 1), cada uno con su propio
 * mapa (los ejes/escalas no se mezclan entre tableros distintos).
 */
export default function EjesResultsProjection({ sesionNombre, cliente, tableros, onClose }: EjesResultsProjectionProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[linear-gradient(160deg,#14495A_0%,#0F3D4D_55%,#0A2F3B_100%)]">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full border-[56px] border-[rgba(2,116,149,.12)]" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 h-[380px] w-[380px] rounded-full border-[48px] border-[rgba(212,160,23,.08)]" />

      <div className="relative flex flex-shrink-0 items-center justify-between px-10 py-8">
        <div>
          {cliente && <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6FC2DA]">{cliente}</p>}
          <h1 className="mt-1 text-[30px] font-bold leading-tight text-white">{sesionNombre}</h1>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative mx-auto w-full max-w-4xl flex-1 space-y-10 px-6 pb-16">
        {tableros.map((tab) => (
          <section key={tab.tableroId}>
            {tableros.length > 1 && (
              <div className="mb-4 flex items-baseline justify-between border-b border-white/10 pb-2">
                <h2 className="text-[19px] font-bold text-white">{tab.tableroNombre}</h2>
                <span className="text-[13px] text-[#8FB6C0]">
                  {tab.totalParticipantesEvaluaron} participante{tab.totalParticipantesEvaluaron !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {tab.ideas.length === 0 ? (
              <p className="text-[15px] text-[#8FB6C0]">Todavía no hay evaluaciones que mostrar.</p>
            ) : (
              <div className="rounded-2xl bg-white/[.05] p-4 ring-1 ring-white/10">
                <EjesQuadrantChart
                  ejeXLabel={tab.ejeXLabel} ejeXMin={tab.ejeXMin} ejeXMax={tab.ejeXMax}
                  ejeYLabel={tab.ejeYLabel} ejeYMin={tab.ejeYMin} ejeYMax={tab.ejeYMax}
                  ideas={tab.ideas}
                  height={420}
                  dotColor="#3FA9C4"
                  gridColor="rgba(255,255,255,0.15)"
                  textColor="#8FB6C0"
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
