import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, X, LayoutList, LayoutGrid, Crown, Zap, Brain, XCircle, HelpCircle } from 'lucide-react';

export type SwipeQuadrante = 'consenso_rapido' | 'convence_cuesta' | 'rechazo_inmediato' | 'duda_genuina';

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
  avgMsDecision?: number;
  quadrante?: SwipeQuadrante;
}

export const QUADRANTE_META: Record<SwipeQuadrante, { label: string; icon: typeof Zap; color: string }> = {
  consenso_rapido: { label: 'Consenso rápido', icon: Zap, color: '#1F9D6F' },
  convence_cuesta: { label: 'Convence, cuesta pensarlo', icon: Brain, color: '#D4A017' },
  rechazo_inmediato: { label: 'Rechazo inmediato', icon: XCircle, color: '#8FA0A6' },
  duda_genuina: { label: 'Duda genuina', icon: HelpCircle, color: '#3FA9C4' },
};

export interface ResultadoCapitulo {
  capituloId: string;
  capituloNombre: string;
  totalParticipantesVotaron: number;
  ideas: ResultadoIdea[];
}

interface SwipeResultsProjectionProps {
  sesionNombre: string;
  cliente?: string;
  capitulos: ResultadoCapitulo[];
  onClose: () => void;
}

const RANK_COLOR = ['#F2C744', '#C9D2D8', '#D89A5C']; // oro/plata/bronce — solo el top 3 se distingue

/** Entre 40% y 60% de aprobación — ni gustó ni se descartó de plano, spec §6: "suelen ser las más interesantes de discutir". */
function esPolarizante(pct: number) {
  return pct >= 40 && pct <= 60;
}

/**
 * Modo proyección (spec §6) — pantalla completa, sin controles de edición,
 * para compartir/proyectar frente al cliente. Acepta uno o varios
 * capítulos a la vez (la vista de un solo capítulo le manda un array de
 * longitud 1) — nunca se mezclan ideas de capítulos distintos en un mismo
 * ranking, cada uno conserva el suyo, solo que pueden verse todos seguidos
 * sin salir y volver a entrar.
 */
export default function SwipeResultsProjection({ sesionNombre, cliente, capitulos, onClose }: SwipeResultsProjectionProps) {
  const [modo, setModo] = useState<'lista' | 'tarjetas'>('lista');

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)]">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full border-[56px] border-[rgba(2,116,149,.12)]" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 h-[380px] w-[380px] rounded-full border-[48px] border-[rgba(212,160,23,.08)]" />

      <div className="relative flex flex-shrink-0 items-center justify-between px-10 py-8">
        <div>
          {cliente && <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6FC2DA]">{cliente}</p>}
          <h1 className="mt-1 text-[30px] font-bold leading-tight text-white">{sesionNombre}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-white/10 p-1">
            <button
              onClick={() => setModo('lista')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${modo === 'lista' ? 'bg-white text-[#0F3D4C]' : 'text-white/70 hover:text-white'}`}
            >
              <LayoutList className="h-3.5 w-3.5" /> Lista
            </button>
            <button
              onClick={() => setModo('tarjetas')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${modo === 'tarjetas' ? 'bg-white text-[#0F3D4C]' : 'text-white/70 hover:text-white'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Tarjetas
            </button>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-4xl flex-1 space-y-10 px-6 pb-16">
        {capitulos.map((cap) => (
          <section key={cap.capituloId}>
            {capitulos.length > 1 && (
              <div className="mb-4 flex items-baseline justify-between border-b border-white/10 pb-2">
                <h2 className="text-[19px] font-bold text-white">{cap.capituloNombre}</h2>
                <span className="text-[13px] text-[#8FB6C0]">
                  {cap.totalParticipantesVotaron} participante{cap.totalParticipantesVotaron !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {cap.ideas.length === 0 ? (
              <p className="text-[15px] text-[#8FB6C0]">Todavía no hay votos que mostrar.</p>
            ) : modo === 'lista' ? (
              <ListaRanking ideas={cap.ideas} />
            ) : (
              <TarjetasRanking ideas={cap.ideas} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ListaRanking({ ideas }: { ideas: ResultadoIdea[] }) {
  return (
    <div className="space-y-3">
      {ideas.map((idea, i) => (
        <motion.div
          key={idea.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 28 }}
          className={`flex items-center gap-4 rounded-2xl p-4 ring-1 ${i === 0 ? 'bg-white/[.09] ring-[#F2C744]/40' : 'bg-white/[.05] ring-white/10'}`}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-black"
            style={{ backgroundColor: i < 3 ? RANK_COLOR[i] : 'rgba(255,255,255,0.1)', color: i < 3 ? '#0A2F3B' : '#8FB6C0' }}
          >
            {i === 0 ? <Crown className="h-4.5 w-4.5" fill="currentColor" /> : i + 1}
          </div>

          <Thumb idea={idea} size={64} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="truncate text-[17px] font-semibold text-white">{idea.titulo}</span>
              <Badges idea={idea} big />
            </div>
            <Bar pct={idea.pctPotencial} />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-[12px] text-white/40">
                {idea.totalVotos} voto{idea.totalVotos !== 1 ? 's' : ''}
                {idea.avgMsDecision !== undefined && ` · ${(idea.avgMsDecision / 1000).toFixed(1)}s prom.`}
              </p>
              <QuadranteBadge quadrante={idea.quadrante} />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function TarjetasRanking({ ideas }: { ideas: ResultadoIdea[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {ideas.map((idea, i) => (
        <motion.div
          key={idea.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
          className={`overflow-hidden rounded-2xl ring-1 ${i === 0 ? 'ring-[#F2C744]/50' : 'ring-white/10'} bg-white/[.05]`}
        >
          <div className="relative aspect-[4/3] w-full bg-white">
            {idea.imagenUrl ? (
              <img src={idea.imagenUrl} alt={idea.titulo} className="h-full w-full object-contain p-3" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#0F3D4C]">
                <span className="px-4 text-center text-[15px] font-semibold text-white/70">{idea.titulo}</span>
              </div>
            )}
            <div
              className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-black shadow"
              style={{ backgroundColor: i < 3 ? RANK_COLOR[i] : 'rgba(10,47,59,0.85)', color: i < 3 ? '#0A2F3B' : '#fff' }}
            >
              {i === 0 ? <Crown className="h-4 w-4" fill="currentColor" /> : i + 1}
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[15px] font-semibold text-white">{idea.titulo}</span>
              <span className="flex-shrink-0 text-[17px] font-bold text-white">{idea.pctPotencial}%</span>
            </div>
            <Bar pct={idea.pctPotencial} />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[12px] text-white/40">{idea.totalVotos} voto{idea.totalVotos !== 1 ? 's' : ''}</p>
              <Badges idea={idea} />
            </div>
            <QuadranteBadge quadrante={idea.quadrante} className="mt-1.5" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function QuadranteBadge({ quadrante, className = '' }: { quadrante?: SwipeQuadrante; className?: string }) {
  if (!quadrante) return null;
  const meta = QUADRANTE_META[quadrante];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${className}`} style={{ color: meta.color }}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function Thumb({ idea, size }: { idea: ResultadoIdea; size: number }) {
  return idea.imagenUrl ? (
    <div className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1" style={{ height: size, width: size }}>
      <img src={idea.imagenUrl} alt={idea.titulo} className="max-h-full max-w-full object-contain" />
    </div>
  ) : (
    <div className="flex-shrink-0 rounded-xl bg-white/10" style={{ height: size, width: size }} />
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#027495] to-[#3FA9C4] transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Badges({ idea, big }: { idea: ResultadoIdea; big?: boolean }) {
  const textSize = big ? 'text-[13px]' : 'text-[11px]';
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      {idea.superLikes > 0 && (
        <span className={`flex items-center gap-1 font-semibold text-[#D4A017] ${textSize}`}>
          <Star className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} fill="currentColor" /> {idea.superLikes}
        </span>
      )}
      {esPolarizante(idea.pctPotencial) && (
        <span className={`rounded-full bg-[#D4A017]/15 px-2.5 py-0.5 font-bold uppercase tracking-wide text-[#D4A017] ${textSize === 'text-[13px]' ? 'text-[11px]' : 'text-[10px]'}`}>
          Polarizante
        </span>
      )}
      {big && <span className="text-[17px] font-bold text-white">{idea.pctPotencial}%</span>}
    </div>
  );
}
