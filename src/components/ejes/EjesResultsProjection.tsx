import { X } from 'lucide-react';
import EjesQuadrantChart, { type EjesIdeaResultado } from './EjesQuadrantChart';
import { TEAL } from '@/lib/toolColors';

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
 * compartir/proyectar frente al cliente. Fondo blanco (a diferencia de
 * SwipeResultsProjection.tsx, que sí usa el navy/teal — aquí el punto
 * central es leer bien el mapa de cuadrantes y el hover con el detalle de
 * cada idea, no la ambientación oscura). Acepta uno o varios tableros a la
 * vez (la vista de un solo tablero le manda un array de longitud 1), cada
 * uno con su propio mapa (los ejes/escalas no se mezclan entre tableros
 * distintos).
 */
export default function EjesResultsProjection({ sesionNombre, cliente, tableros, onClose }: EjesResultsProjectionProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-10 py-8">
        <div>
          {cliente && <p className="text-[13px] font-bold uppercase tracking-[0.2em]" style={{ color: TEAL }}>{cliente}</p>}
          <h1 className="mt-1 text-[30px] font-bold leading-tight" style={{ color: TEAL }}>{sesionNombre}</h1>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 space-y-10 px-6 pb-16 pt-8">
        {tableros.map((tab) => (
          <section key={tab.tableroId}>
            {tableros.length > 1 && (
              <div className="mb-4 flex items-baseline justify-between border-b border-border pb-2">
                <h2 className="text-[19px] font-bold text-foreground">{tab.tableroNombre}</h2>
                <span className="text-[13px] text-muted-foreground">
                  {tab.totalParticipantesEvaluaron} participante{tab.totalParticipantesEvaluaron !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {tab.ideas.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">Todavía no hay evaluaciones que mostrar.</p>
            ) : (
              <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                <EjesQuadrantChart
                  ejeXLabel={tab.ejeXLabel} ejeXMin={tab.ejeXMin} ejeXMax={tab.ejeXMax}
                  ejeYLabel={tab.ejeYLabel} ejeYMin={tab.ejeYMin} ejeYMax={tab.ejeYMax}
                  ideas={tab.ideas}
                  height={420}
                  dotColor={TEAL}
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
