import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { getSwipeEstado, getSwipeCapitulo, joinSwipeSesion, submitSwipeVotos } from 'zite-endpoints-sdk';
import SwipeCardStack, { type SwipeIdea } from '@/components/swipe/SwipeCardStack';

// Mismo logo que ObservationRoomPage.tsx / LoginPage.tsx — identidad real de
// Sapience, esta también es una página pública sin login.
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

interface StoredParticipante { participanteId: string; alias: string; deviceToken: string }

interface EstadoSesion {
  found: boolean;
  estadoSesion?: string;
  nombre?: string;
  cliente?: string;
  capituloActivo?: { id: string; nombre: string; descripcion?: string; totalIdeas: number } | null;
}

interface CapituloCargado {
  id: string;
  nombre: string;
  descripcion?: string;
  ideas: SwipeIdea[];
  superLikesRestantes: number;
}

type Phase = 'loading' | 'notfound' | 'join' | 'waiting' | 'intro' | 'cards' | 'done';

function storageKey(codigo: string) {
  return `swipe_participante_${codigo}`;
}

/**
 * Página pública `/swipe/:codigo` — hermana de <Layout> en App.tsx, nunca
 * pasa por useAuth(). Mismo esqueleto que ObservationRoomPage.tsx: estado
 * `undefined` = cargando, `{found:false}` = código inválido, device token en
 * localStorage por código, pantalla de alias solo si no hay participante
 * guardado. Ver plan del módulo Swipe (Fase 1) para el alcance completo.
 */
export default function SwipePage() {
  const { codigo = '' } = useParams();
  const [participante, setParticipante] = useState<StoredParticipante | null>(null);
  const [estado, setEstado] = useState<EstadoSesion | undefined>(undefined);
  const [capitulo, setCapitulo] = useState<CapituloCargado | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const completedRef = useRef<Set<string>>(new Set());

  const [aliasInput, setAliasInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(codigo));
    if (raw) {
      try { setParticipante(JSON.parse(raw)); } catch { /* localStorage corrupto, se ignora */ }
    }
  }, [codigo]);

  const loadEstado = async () => {
    try {
      const res = await getSwipeEstado({ codigo });
      setEstado(res);
    } catch {
      setEstado({ found: false });
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEstado(); }, [codigo]);

  // Poll ligero mientras la pestaña esté visible — mismo patrón que
  // ObservationRoomPage.tsx, con intervalo más corto porque el ritmo de un
  // workshop es más rápido que el de una transmisión.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadEstado();
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  // Carga las ideas del capítulo activo en cuanto cambia (y precarga sus
  // imágenes) — spec §5: sin esto el primer swipe tiene medio segundo de
  // card en blanco.
  useEffect(() => {
    if (!participante || !estado?.found || !estado.capituloActivo) return;
    const capId = estado.capituloActivo.id;
    if (completedRef.current.has(capId) || capitulo?.id === capId) return;

    let cancelled = false;
    getSwipeCapitulo({ capituloId: capId, participanteId: participante.participanteId }).then((res) => {
      if (cancelled || !res.found) return;
      (res.ideas ?? []).forEach((idea: SwipeIdea) => {
        if (idea.imagenUrl) { const img = new Image(); img.src = idea.imagenUrl; }
      });
      setCapitulo({
        id: capId,
        nombre: res.nombre,
        descripcion: res.descripcion,
        ideas: res.ideas ?? [],
        superLikesRestantes: res.superLikesRestantes ?? 0,
      });
    });
    return () => { cancelled = true; };
  }, [participante, estado?.capituloActivo?.id, estado?.found, capitulo?.id]);

  // Deriva la pantalla a mostrar. Usa el valor previo para 'cards': el poll
  // de estado no debe sacar al participante de mitad del stack.
  useEffect(() => {
    if (estado === undefined) { setPhase('loading'); return; }
    if (!estado.found) { setPhase('notfound'); return; }
    if (!participante) { setPhase('join'); return; }
    if (!estado.capituloActivo) {
      setPhase(estado.estadoSesion === 'cerrada' ? 'done' : 'waiting');
      return;
    }
    if (completedRef.current.has(estado.capituloActivo.id)) { setPhase('waiting'); return; }
    if (capitulo?.id !== estado.capituloActivo.id) { setPhase('loading'); return; }
    setPhase((prev) => (prev === 'cards' ? 'cards' : 'intro'));
  }, [estado, participante, capitulo]);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!aliasInput.trim()) return;
    setJoinError('');
    setJoining(true);
    try {
      const deviceToken = crypto.randomUUID();
      const res = await joinSwipeSesion({ codigo, alias: aliasInput.trim(), deviceToken });
      if (!res.found || !res.participanteId) {
        setJoinError('Este código no corresponde a ninguna sesión.');
        setJoining(false);
        return;
      }
      const stored: StoredParticipante = { participanteId: res.participanteId, alias: aliasInput.trim(), deviceToken };
      localStorage.setItem(storageKey(codigo), JSON.stringify(stored));
      setParticipante(stored);
    } catch (err) {
      setJoinError((err as Error)?.message || 'No se pudo entrar a la sesión.');
    }
    setJoining(false);
  };

  const handleVote = (ideaId: string, valor: 'potencial' | 'descarte' | 'super', msDecision: number) => {
    if (!participante) return;
    // No bloquea el avance de la card — se dispara en segundo plano. Sin
    // buffer/reintentos todavía (eso es Fase 3 del spec, "Resiliencia de
    // red"); aquí solo se evita que la UI espere a la red.
    submitSwipeVotos({ participanteId: participante.participanteId, votos: [{ ideaId, valor, msDecision }] }).catch(() => {});
  };

  const handleComplete = () => {
    if (capitulo) completedRef.current.add(capitulo.id);
    setPhase('waiting');
  };

  if (phase === 'loading') return <CenterMessage>Cargando…</CenterMessage>;
  if (phase === 'notfound') return <CenterMessage>Este código no corresponde a ninguna sesión.</CenterMessage>;

  if (phase === 'join') {
    return (
      <JoinScreen
        nombre={estado?.nombre}
        cliente={estado?.cliente}
        value={aliasInput}
        onChange={setAliasInput}
        onSubmit={handleJoin}
        joining={joining}
        error={joinError}
      />
    );
  }

  if (phase === 'done') {
    return (
      <CenterMessage>
        <div className="space-y-2">
          <p className="text-lg font-semibold text-[#0F3D4C]">¡Gracias por participar!</p>
          <p>La sesión ha terminado.</p>
        </div>
      </CenterMessage>
    );
  }

  if (phase === 'waiting') {
    return <CenterMessage>Listo. Esperando al siguiente capítulo…</CenterMessage>;
  }

  if (phase === 'intro' && capitulo) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0F3D4C] px-6 text-center text-white">
        <img src={LOGO_URL} alt="Sapience" className="mb-8 h-7 w-auto" />
        <h1 className="text-2xl font-bold">{capitulo.nombre}</h1>
        {capitulo.descripcion && <p className="mt-3 max-w-sm text-[15px] text-[#8FB6C0]">{capitulo.descripcion}</p>}
        <p className="mt-4 text-sm text-[#3FA9C4]">
          {capitulo.ideas.length} ideas · {capitulo.superLikesRestantes} super like{capitulo.superLikesRestantes !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setPhase('cards')}
          className="mt-9 rounded-full bg-[#027495] px-10 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#025F7A]"
        >
          Empezar
        </button>
      </div>
    );
  }

  if (phase === 'cards' && capitulo) {
    return (
      <div className="h-dvh overscroll-none bg-[#0F3D4C]">
        <SwipeCardStack
          ideas={capitulo.ideas}
          superLikesRestantes={capitulo.superLikesRestantes}
          onVote={handleVote}
          onComplete={handleComplete}
        />
      </div>
    );
  }

  return <CenterMessage>Cargando…</CenterMessage>;
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F2F7F8] px-6 text-center text-sm text-[#6E8388]">
      {children}
    </div>
  );
}

function JoinScreen({
  nombre, cliente, value, onChange, onSubmit, joining, error,
}: {
  nombre?: string;
  cliente?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  joining: boolean;
  error: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0F3D4C] px-6 pb-10 pt-14 text-white">
      {/* self-start: el padre es flex-col sin items-center, así que por
          default el logo se estiraba a lo ancho del contenedor (stretch es
          el align-items implícito) — sin esto se veía deformado. */}
      <img src={LOGO_URL} alt="Sapience" className="h-7 w-auto self-start" />
      <div className="flex flex-1 flex-col justify-center">
        {nombre && (
          <p className="mb-1 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#6FC2DA]">{cliente ?? 'Sapience'}</p>
        )}
        <h1 className="mb-2 text-[26px] font-bold leading-tight">{nombre ?? 'Sesión de Swipe'}</h1>
        <p className="mb-8 text-[15px] text-[#8FB6C0]">Escribe cómo quieres que te vean en esta sesión.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            required autoFocus maxLength={40}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Tu alias"
            className="w-full rounded-[10px] border-[1.5px] border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-[#3FA9C4]"
          />
          {error && <p className="text-[13px] text-[#F2A19B]">{error}</p>}
          <button
            type="submit" disabled={joining}
            className="w-full rounded-[10px] bg-[#027495] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:enabled:bg-[#025F7A] disabled:opacity-60"
          >
            {joining ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
