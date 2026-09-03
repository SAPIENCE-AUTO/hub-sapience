import { Star, X } from 'lucide-react';

export interface ResultadoIdea {
  id: string;
  titulo: string;
  imagenUrl?: string;
  totalVotos: number;
  potencial: number;
  descarte: number;
  superLikes: number;
  pctPotencial: number;
  score: number;
}

interface SwipeResultsProjectionProps {
  sesionNombre: string;
  cliente?: string;
  capituloNombre: string;
  totalParticipantesVotaron: number;
  ideas: ResultadoIdea[];
  onClose: () => void;
}

const RANK_COLOR = ['#D4AF37', '#B8C0C8', '#B87333']; // oro/plata/bronce — solo el top 3 se distingue, el resto es un mismo tono neutro

/** Entre 40% y 60% de aprobación — ni gustó ni se descartó de plano, spec §6: "suelen ser las más interesantes de discutir". */
function esPolarizante(pct: number) {
  return pct >= 40 && pct <= 60;
}

/**
 * Modo proyección (spec §6) — pantalla completa, sin controles de edición,
 * pensada para compartir/proyectar frente al cliente. Vive como overlay
 * sobre el dashboard del facilitador (no es una ruta aparte: se abre y
 * cierra sin perder el estado de la sesión ya seleccionada).
 */
export default function SwipeResultsProjection({
  sesionNombre, cliente, capituloNombre, totalParticipantesVotaron, ideas, onClose,
}: SwipeResultsProjectionProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)]">
      <div className="flex flex-shrink-0 items-center justify-between px-10 py-8">
        <div>
          {cliente && <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6FC2DA]">{cliente}</p>}
          <h1 className="mt-1 text-[28px] font-bold leading-tight text-white">{sesionNombre}</h1>
          <p className="mt-1 text-[15px] text-[#8FB6C0]">
            {capituloNombre} · {totalParticipantesVotaron} participante{totalParticipantesVotaron !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-6 pb-16">
        {ideas.length === 0 && <p className="text-center text-[15px] text-[#8FB6C0]">Todavía no hay votos que mostrar.</p>}
        {ideas.map((idea, i) => (
          <div key={idea.id} className="flex items-center gap-4 rounded-2xl bg-white/[.06] p-4 ring-1 ring-white/10">
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-black"
              style={{
                backgroundColor: i < 3 ? RANK_COLOR[i] : 'rgba(255,255,255,0.1)',
                color: i < 3 ? '#0A2F3B' : '#8FB6C0',
              }}
            >
              {i + 1}
            </div>

            {idea.imagenUrl ? (
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
                <img src={idea.imagenUrl} alt={idea.titulo} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <div className="h-16 w-16 flex-shrink-0 rounded-xl bg-white/10" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="truncate text-[17px] font-semibold text-white">{idea.titulo}</span>
                <div className="flex flex-shrink-0 items-center gap-3">
                  {idea.superLikes > 0 && (
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-[#D4A017]">
                      <Star className="h-3.5 w-3.5" fill="currentColor" /> {idea.superLikes}
                    </span>
                  )}
                  {esPolarizante(idea.pctPotencial) && (
                    <span className="rounded-full bg-[#D4A017]/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#D4A017]">
                      Polarizante
                    </span>
                  )}
                  <span className="text-[17px] font-bold text-white">{idea.pctPotencial}%</span>
                </div>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#027495] to-[#3FA9C4] transition-all duration-500"
                  style={{ width: `${idea.pctPotencial}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] text-white/40">{idea.totalVotos} voto{idea.totalVotos !== 1 ? 's' : ''}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
