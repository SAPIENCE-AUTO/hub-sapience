import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { getEjesEstado, joinEjesSesion, submitEjesEvaluacion } from 'zite-endpoints-sdk';
import EjesEvaluacionSliders, { type EjesIdea } from '@/components/ejes/EjesEvaluacionSliders';

// Mismo logo que SwipePage.tsx/ObservationRoomPage.tsx/LoginPage.tsx.
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

interface StoredParticipante { participanteId: string; alias: string; deviceToken: string }

interface TableroActivo {
  id: string;
  nombre: string;
  descripcion?: string;
  totalIdeas: number;
  ejeXLabel: string; ejeXMin: number; ejeXMax: number;
  ejeYLabel: string; ejeYMin: number; ejeYMax: number;
  cuadranteAltoAltoLabel?: string; cuadranteBajoAltoLabel?: string;
  cuadranteBajoBajoLabel?: string; cuadranteAltoBajoLabel?: string;
  ideaActiva: (EjesIdea & { orden: number }) | null;
}

interface EstadoSesion {
  found: boolean;
  estadoSesion?: string;
  nombre?: string;
  cliente?: string;
  tableroActivo?: TableroActivo | null;
}

type Phase = 'loading' | 'notfound' | 'join' | 'waiting' | 'intro' | 'evaluando' | 'esperando_idea' | 'done';

function storageKey(codigo: string) {
  return `ejes_participante_${codigo}`;
}

/**
 * Página pública `/ejes/:codigo` — hermana de <Layout> en App.tsx, nunca
 * pasa por useAuth(). Las ideas se activan 1 a 1 (no todo el tablero de
 * golpe): `getEjesEstado` ya trae la idea activa completa dentro de
 * `tableroActivo`, así que no hace falta un segundo fetch por tablero.
 * `completedIdeaIds` evita re-mostrar el formulario si el polling (4s)
 * vuelve a traer la misma idea antes de que el facilitador la cierre.
 */
export default function EjesPage() {
  const { codigo = '' } = useParams();
  const [participante, setParticipante] = useState<StoredParticipante | null>(null);
  const [estado, setEstado] = useState<EstadoSesion | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tableroIntroVistoId, setTableroIntroVistoId] = useState<string | null>(null);
  const completedIdeaIds = useRef<Set<string>>(new Set());
  const preloadedRef = useRef<Set<string>>(new Set());

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
      const res = await getEjesEstado({ codigo });
      setEstado(res);
    } catch {
      setEstado({ found: false });
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEstado(); }, [codigo]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadEstado();
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  const ideaActiva = estado?.tableroActivo?.ideaActiva;

  useEffect(() => {
    if (ideaActiva?.imagenUrl && !preloadedRef.current.has(ideaActiva.id)) {
      preloadedRef.current.add(ideaActiva.id);
      const img = new Image();
      img.src = ideaActiva.imagenUrl;
    }
  }, [ideaActiva]);

  useEffect(() => {
    if (estado === undefined) { setPhase('loading'); return; }
    if (!estado.found) { setPhase('notfound'); return; }
    if (!participante) { setPhase('join'); return; }
    const tablero = estado.tableroActivo;
    if (!tablero) { setPhase(estado.estadoSesion === 'cerrada' ? 'done' : 'waiting'); return; }
    if (tableroIntroVistoId !== tablero.id) { setPhase('intro'); return; }
    if (!tablero.ideaActiva || completedIdeaIds.current.has(tablero.ideaActiva.id)) { setPhase('esperando_idea'); return; }
    setPhase('evaluando');
  }, [estado, participante, tableroIntroVistoId]);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!aliasInput.trim()) return;
    setJoinError('');
    setJoining(true);
    try {
      const deviceToken = crypto.randomUUID();
      const res = await joinEjesSesion({ codigo, alias: aliasInput.trim(), deviceToken });
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

  const handleConfirmar = (valorX: number, valorY: number, msDecision: number) => {
    if (!participante || !ideaActiva) return;
    completedIdeaIds.current.add(ideaActiva.id);
    submitEjesEvaluacion({ participanteId: participante.participanteId, ideaId: ideaActiva.id, valorX, valorY, msDecision }).catch(() => {});
    setPhase('esperando_idea');
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
          <p className="text-lg font-semibold text-[#0F3D4D]">¡Gracias por participar!</p>
          <p>La sesión ha terminado.</p>
        </div>
      </CenterMessage>
    );
  }

  if (phase === 'waiting') {
    return <CenterMessage>Listo. Esperando al siguiente tablero…</CenterMessage>;
  }

  if (phase === 'esperando_idea') {
    return <CenterMessage>Listo. Esperando la siguiente idea…</CenterMessage>;
  }

  if (phase === 'intro' && estado?.tableroActivo) {
    const tablero = estado.tableroActivo;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0F3D4D] px-6 text-center text-white">
        <img src={LOGO_URL} alt="Sapience" className="mb-8 h-7 w-auto" />
        <h1 className="text-2xl font-bold">{tablero.nombre}</h1>
        {tablero.descripcion && <p className="mt-3 max-w-sm text-[15px] text-[#8FB6C0]">{tablero.descripcion}</p>}
        <p className="mt-4 text-sm text-[#3FA9C4]">
          {tablero.totalIdeas} ideas · {tablero.ejeXLabel} × {tablero.ejeYLabel}
        </p>
        <button
          onClick={() => setTableroIntroVistoId(tablero.id)}
          className="mt-9 rounded-full bg-[#027495] px-10 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#025F7A]"
        >
          Empezar
        </button>
      </div>
    );
  }

  if (phase === 'evaluando' && estado?.tableroActivo?.ideaActiva) {
    const tablero = estado.tableroActivo;
    const idea = tablero.ideaActiva!;
    return (
      <div className="h-dvh overscroll-none bg-[#0F3D4D]">
        <EjesEvaluacionSliders
          idea={idea}
          progresoActual={idea.orden + 1}
          progresoTotal={tablero.totalIdeas}
          ejeXLabel={tablero.ejeXLabel} ejeXMin={tablero.ejeXMin} ejeXMax={tablero.ejeXMax}
          ejeYLabel={tablero.ejeYLabel} ejeYMin={tablero.ejeYMin} ejeYMax={tablero.ejeYMax}
          cuadranteAltoAltoLabel={tablero.cuadranteAltoAltoLabel}
          cuadranteBajoAltoLabel={tablero.cuadranteBajoAltoLabel}
          cuadranteBajoBajoLabel={tablero.cuadranteBajoBajoLabel}
          cuadranteAltoBajoLabel={tablero.cuadranteAltoBajoLabel}
          onConfirmar={handleConfirmar}
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
    <div className="flex min-h-dvh flex-col bg-[#0F3D4D] px-6 pb-10 pt-14 text-white">
      <img src={LOGO_URL} alt="Sapience" className="h-7 w-auto self-start" />
      <div className="flex flex-1 flex-col justify-center">
        {nombre && (
          <p className="mb-1 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#6FC2DA]">{cliente ?? 'Sapience'}</p>
        )}
        <h1 className="mb-2 text-[26px] font-bold leading-tight">{nombre ?? 'Sesión de Ejes'}</h1>
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
