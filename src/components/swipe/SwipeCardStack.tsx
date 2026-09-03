import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';
import { Heart, Star, X } from 'lucide-react';

export interface SwipeIdea {
  id: string;
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
}

type Valor = 'potencial' | 'descarte' | 'super';

interface SwipeCardStackProps {
  ideas: SwipeIdea[];
  superLikesRestantes: number;
  onVote: (ideaId: string, valor: Valor, msDecision: number) => void;
  onComplete: () => void;
}

const DRAG_THRESHOLD_X = 110; // px — cruce que decide potencial/descarte
const DRAG_THRESHOLD_Y = 100; // px — cruce hacia arriba que decide el super like
const SPRING_BACK = { type: 'spring', stiffness: 420, damping: 32 } as const;

/**
 * Solo el card de hasta arriba es arrastrable (arriba/izquierda/derecha); los
 * de atrás son estáticos con `scale`/`translateY` decrecientes (spec §5).
 * El vuelo de salida es una animación imperativa sobre los motion values de
 * `x`/`y` (no el prop declarativo `animate`) para poder disparar el mismo
 * gesto tanto desde el drag como desde los botones de respaldo — ver
 * `TopCard.fly` vía `useImperativeHandle`.
 */
export default function SwipeCardStack({ ideas, superLikesRestantes: initialSuperLikes, onVote, onComplete }: SwipeCardStackProps) {
  const [index, setIndex] = useState(0);
  const [superLikesRestantes, setSuperLikesRestantes] = useState(initialSuperLikes);
  const [blockedMsg, setBlockedMsg] = useState(false);
  const shownAtRef = useRef(Date.now());
  const topCardRef = useRef<{ fly: (valor: Valor) => void }>(null);

  const showBlockedMsg = () => {
    setBlockedMsg(true);
    setTimeout(() => setBlockedMsg(false), 1800);
  };

  const handleDecide = (valor: Valor) => {
    const ideaActual = ideas[index];
    if (!ideaActual) return;
    onVote(ideaActual.id, valor, Date.now() - shownAtRef.current);
    if (valor === 'super') setSuperLikesRestantes((n) => Math.max(0, n - 1));
    const next = index + 1;
    setIndex(next);
    shownAtRef.current = Date.now();
    if (next >= ideas.length) onComplete();
  };

  const triggerFly = (valor: Valor) => {
    if (valor === 'super' && superLikesRestantes <= 0) { showBlockedMsg(); return; }
    topCardRef.current?.fly(valor);
  };

  if (index >= ideas.length) return null;

  const visible = ideas.slice(index, index + 3);

  return (
    <div className="flex h-full flex-col overscroll-none">
      <div className="flex-shrink-0 px-5 pt-3">
        <div className="flex gap-1">
          {ideas.map((idea, i) => (
            <div
              key={idea.id}
              className={`h-1 flex-1 rounded-full transition-colors ${i < index ? 'bg-[#3FA9C4]' : i === index ? 'bg-white/70' : 'bg-white/15'}`}
            />
          ))}
        </div>
        <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
          {index + 1} / {ideas.length}
        </p>
      </div>

      <div className="relative flex-1 px-5 pb-2 pt-3">
        {visible.map((idea, i) =>
          i === 0 ? (
            <TopCard
              key={idea.id}
              ref={topCardRef}
              idea={idea}
              superLikesRestantes={superLikesRestantes}
              onDecide={handleDecide}
              onBlockedSuper={showBlockedMsg}
            />
          ) : (
            <StaticCard key={idea.id} idea={idea} depth={i} />
          ),
        )}

        {blockedMsg && (
          <div className="pointer-events-none absolute inset-x-6 top-4 z-20 rounded-full bg-black/70 px-4 py-2 text-center text-[13px] font-medium text-white backdrop-blur-sm">
            Ya usaste tus {initialSuperLikes} super likes
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-center gap-6 py-6">
        <button
          onClick={() => triggerFly('descarte')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#C4302B] shadow-lg transition-transform active:scale-90"
          aria-label="Descartar"
        >
          <X className="h-6 w-6" strokeWidth={2.75} />
        </button>
        <button
          onClick={() => triggerFly('super')}
          className={`flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-transform active:scale-90 ${superLikesRestantes > 0 ? 'bg-white text-[#D4A017]' : 'bg-white/30 text-white/50'}`}
          aria-label="Super like"
        >
          <Star className="h-5 w-5" fill="currentColor" />
        </button>
        <button
          onClick={() => triggerFly('potencial')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#1F9D6F] shadow-lg transition-transform active:scale-90"
          aria-label="Potencial"
        >
          <Heart className="h-6 w-6" fill="currentColor" />
        </button>
      </div>
    </div>
  );
}

function StaticCard({ idea, depth }: { idea: SwipeIdea; depth: number }) {
  return (
    <div
      className="absolute inset-5 overflow-hidden rounded-[24px] shadow-lg"
      style={{ transform: `scale(${1 - depth * 0.04}) translateY(${depth * 14}px)`, zIndex: 10 - depth }}
    >
      <CardBody idea={idea} />
    </div>
  );
}

const TopCard = forwardRef<{ fly: (valor: Valor) => void }, {
  idea: SwipeIdea;
  superLikesRestantes: number;
  onDecide: (valor: Valor) => void;
  onBlockedSuper: () => void;
}>(({ idea, superLikesRestantes, onDecide, onBlockedSuper }, ref) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-16, 16]);
  const potencialOpacity = useTransform(x, [20, DRAG_THRESHOLD_X], [0, 1]);
  const descarteOpacity = useTransform(x, [-DRAG_THRESHOLD_X, -20], [1, 0]);
  const superOpacity = useTransform(y, [-DRAG_THRESHOLD_Y, -20], [1, 0]);

  const fly = (valor: Valor) => {
    const target = valor === 'potencial' ? { x: 700, y: -60 } : valor === 'descarte' ? { x: -700, y: -60 } : { x: 0, y: -1000 };
    Promise.all([
      animate(x, target.x, { duration: 0.3, ease: 'easeIn' }),
      animate(y, target.y, { duration: 0.3, ease: 'easeIn' }),
    ]).then(() => onDecide(valor));
  };
  useImperativeHandle(ref, () => ({ fly }));

  const springBack = () => { animate(x, 0, SPRING_BACK); animate(y, 0, SPRING_BACK); };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { x: ox, y: oy } = info.offset;
    if (oy < -DRAG_THRESHOLD_Y && Math.abs(oy) > Math.abs(ox)) {
      if (superLikesRestantes > 0) fly('super');
      else { onBlockedSuper(); springBack(); }
      return;
    }
    if (ox > DRAG_THRESHOLD_X) { fly('potencial'); return; }
    if (ox < -DRAG_THRESHOLD_X) { fly('descarte'); return; }
    springBack();
  };

  return (
    <motion.div
      className="absolute inset-5 overflow-hidden rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/10"
      style={{ x, y, rotate, touchAction: 'none', zIndex: 10 }}
      drag
      dragElastic={1}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
    >
      <Badge label="Potencial" color="#1F9D6F" opacity={potencialOpacity} rotate={-8} side="left" />
      <Badge label="Descarte" color="#C4302B" opacity={descarteOpacity} rotate={8} side="right" />
      <Badge label="Super like" color="#D4A017" opacity={superOpacity} rotate={0} side="top" />
      <CardBody idea={idea} />
    </motion.div>
  );
});
TopCard.displayName = 'TopCard';

function Badge({ label, color, opacity, rotate, side }: {
  label: string; color: string; opacity: ReturnType<typeof useTransform>; rotate: number;
  side: 'left' | 'right' | 'top';
}) {
  const position = side === 'left' ? 'left-5 top-6' : side === 'right' ? 'right-5 top-6' : 'left-1/2 top-6 -translate-x-1/2';
  return (
    <motion.div
      style={{ opacity, rotate: side === 'top' ? 0 : rotate, borderColor: color, color }}
      className={`pointer-events-none absolute ${position} z-10 rounded-xl border-[3px] px-3 py-1 text-lg font-black uppercase tracking-wide`}
    >
      {label}
    </motion.div>
  );
}

/**
 * Con imagen: fondo desenfocado (la misma imagen, escalada y borrosa)
 * llenando la card + la imagen real centrada con `object-contain` encima —
 * así una foto vertical, un logo apaisado o cualquier proporción se ve
 * completa y nítida, nunca recortada ni "gigante" por un `object-cover`
 * forzando una proporción que la imagen real no tiene. Degradado inferior
 * con el texto encima, mismo patrón que Tinder/Hinge. Sin imagen: gradient
 * de marca con el texto centrado, para que la idea no se sienta a medias.
 */
export function CardBody({ idea }: { idea: SwipeIdea }) {
  if (!idea.imagenUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)] px-8 text-center">
        <h2 className="text-[26px] font-bold leading-tight text-white">{idea.titulo}</h2>
        {idea.descripcion && <p className="mt-3 text-[15px] leading-relaxed text-[#8FB6C0]">{idea.descripcion}</p>}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0A2F3B]">
      <img
        src={idea.imagenUrl} alt="" aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
        draggable={false}
      />
      {/* Fondo blanco fijo detrás de la imagen — sin esto, un PNG con
          transparencia (un logo, típicamente) dejaba ver el desenfoque
          navy de atrás y se veía roto. Blanco funciona igual para fotos
          opacas (quedan tapadas por completo, invisible). */}
      <div className="absolute inset-0 flex items-center justify-center p-6 pb-32">
        <div className="flex h-[58%] w-[84%] items-center justify-center overflow-hidden rounded-2xl bg-white p-3 shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
          <img
            src={idea.imagenUrl} alt={idea.titulo}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-5 pb-6 pt-16">
        <h2 className="text-[24px] font-bold leading-tight text-white">{idea.titulo}</h2>
        {idea.descripcion && <p className="mt-1.5 text-[15px] leading-snug text-white/80">{idea.descripcion}</p>}
      </div>
    </div>
  );
}
