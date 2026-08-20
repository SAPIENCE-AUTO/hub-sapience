import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  getObservationRoomPublic, registerObserver, getObservationChatMessages,
  getObservationChatToken, postObserverChatMessage, postObserverHeartbeat,
} from 'zite-endpoints-sdk';
import { useObservationChat, type ObservationChatMessage } from '@/hooks/useObservationChat';
import { Eye, MessageSquare, Play, Pause, Volume2, VolumeX, Maximize, Minimize, HelpCircle, LogOut, Smile } from 'lucide-react';

// Carga perezosa — la mayoría de los observadores nunca abre el picker, y
// esta página pública debe cargar rápido en el primer vistazo (viene de un
// link de correo, no de una sesión ya autenticada en el Hub).
const EmojiPicker = lazy(() => import('emoji-picker-react'));
import '@mux/mux-player';

const CHAT_WIDTH_MIN = 260;
const CHAT_WIDTH_MAX = 480;
const CHAT_WIDTH_DEFAULT = 340;

// Mismos hex que src/pages/LoginPage.tsx / server/templates/odc.html —
// la Sala de observación es lo primero que ve un cliente externo, así que
// usa la identidad de marca real de Sapience, no un tema genérico de "app
// de video".
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

interface PublicSession {
  found: boolean;
  slug?: string;
  nombre?: string;
  cliente?: string;
  estado?: 'borrador' | 'esperando' | 'vivo' | 'terminada';
  muxPlaybackId?: string;
  muxAssetPlaybackId?: string;
  observadoresOnline?: number;
}

interface StoredObserver { observerId: string; nombre: string }

function storageKey(slug: string) {
  return `obs_observer_${slug}`;
}

interface RegisterFormValues { nombre: string; apellido: string; email: string }

const estadoBadge: Record<string, string> = {
  esperando: 'bg-[#F2F7F8] text-[#0F3D4C]',
  vivo: 'bg-[#C4302B] text-white',
  terminada: 'bg-white/10 text-white/70',
};
const estadoLabel: Record<string, string> = {
  esperando: 'Próximamente', vivo: 'En vivo', terminada: 'Terminada',
};

/**
 * Página pública `/s/:slug` — hermana de <Layout> en App.tsx, nunca pasa por
 * useAuth(). Registro obligatorio (la puerta, no un paso opcional) y luego
 * video + chat. Ver CLAUDE (1).md para las decisiones de producto.
 */
export default function ObservationRoomPage() {
  const { slug = '' } = useParams();
  const [session, setSession] = useState<PublicSession | undefined>(undefined); // undefined = cargando
  const [observer, setObserver] = useState<StoredObserver | null>(null);
  const [form, setForm] = useState<RegisterFormValues>({ nombre: '', apellido: '', email: '' });
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');

  // El chat sigue montado (nunca se desmonta) aunque esté plegado, así la
  // suscripción de Ably no se corta y los mensajes que llegan mientras está
  // cerrado alimentan el contador de no-leídos en vez de perderse.
  const [chatOpen, setChatOpen] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
  const draggingRef = useRef(false);

  useEffect(() => { if (chatOpen) setUnreadCount(0); }, [chatOpen]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setChatWidth(Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(slug));
    if (raw) {
      try { setObserver(JSON.parse(raw)); } catch { /* localStorage corrupto, se ignora */ }
    }
  }, [slug]);

  const load = async () => {
    try {
      const res = await getObservationRoomPublic({ slug });
      setSession(res);
    } catch {
      setSession({ found: false });
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [slug]);

  // Poll cada 15s mientras la sesión siga activa (patrón: setInterval +
  // guard de visibilidad; ver SupplierInvoicesPage.tsx). Antes se detenía
  // en cuanto pasaba a "vivo" (solo servía para detectar el arranque) —
  // pero el conteo de "N observando" del encabezado también depende de
  // este mismo fetch, así que se quedaba congelado en lo que decía al
  // cargar la página durante TODA la sesión en vivo. Se detiene solo una
  // vez "terminada" Y con la grabación ya lista — el asset de Mux tarda
  // unos minutos en procesarse después de que el live stream se apaga, así
  // que hay que seguir insistiendo un rato más incluso después de "terminada".
  useEffect(() => {
    if (session?.estado === 'terminada' && session?.muxAssetPlaybackId) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.estado, session?.muxAssetPlaybackId, slug]);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setRegistering(true);
    try {
      const res = await registerObserver({ slug, ...form });
      const stored: StoredObserver = { observerId: res.observerId, nombre: form.nombre };
      localStorage.setItem(storageKey(slug), JSON.stringify(stored));
      setObserver(stored);
    } catch (err) {
      setError((err as Error)?.message || 'No se pudo completar el registro.');
    }
    setRegistering(false);
  };

  // Presencia simple: un heartbeat cada 30s mientras la pestaña esté
  // abierta. A propósito SIN guard de Page Visibility (ver CLAUDE (1).md) —
  // no se mide atención, solo "conectado o no".
  useEffect(() => {
    if (!observer) return;
    const ping = () => postObserverHeartbeat({ slug, observerId: observer.observerId }).catch(() => {});
    ping();
    const interval = setInterval(ping, 30_000);
    return () => clearInterval(interval);
  }, [observer, slug]);

  const handleNotMe = () => {
    localStorage.removeItem(storageKey(slug));
    setObserver(null);
  };

  if (session === undefined) return <CenterMessage>Cargando...</CenterMessage>;
  if (!session.found) return <CenterMessage>Esta sesión no está disponible.</CenterMessage>;

  if (!observer) {
    return (
      <RegisterScreen
        session={session}
        form={form}
        setForm={setForm}
        onSubmit={handleRegister}
        registering={registering}
        error={error}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0A1418]">
      <header className="flex flex-shrink-0 items-center gap-3 bg-[#0F3D4C] px-3 py-2.5 md:px-6">
        <img src={LOGO_URL} alt="Sapience" className="hidden h-6 w-auto flex-shrink-0 sm:block" />
        <div className="min-w-0 border-l border-white/15 pl-3 sm:pl-3">
          <h1 className="truncate text-sm font-semibold text-white">{session.nombre}</h1>
          {session.cliente && <p className="truncate text-[11px] text-[#8FB6C0]">{session.cliente}</p>}
        </div>

        {session.estado && (
          <span className={`hidden flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] sm:flex ${estadoBadge[session.estado] ?? 'bg-white/10 text-white'}`}>
            {session.estado === 'vivo' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#E0453C]" />}
            {estadoLabel[session.estado] ?? session.estado}
          </span>
        )}

        {!!session.observadoresOnline && (
          <span className="hidden flex-shrink-0 items-center gap-1 text-[11px] text-[#8FB6C0] md:flex">
            <Eye className="h-3.5 w-3.5" /> {session.observadoresOnline} observando
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setChatOpen((v) => !v)}
          className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${chatOpen ? 'bg-[#027495] text-white' : 'bg-white/10 text-white hover:bg-white/15'}`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Chat</span>
          {unreadCount > 0 && !chatOpen && (
            <span className="rounded-full bg-[#C4302B] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{unreadCount}</span>
          )}
        </button>

        <button
          onClick={handleNotMe}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
          title={`Salir y dejar de ser ${observer.nombre}`}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center bg-[#0A1418] p-2 md:p-4"
          style={{ containerType: 'size' } as CSSProperties}
        >
          <VideoStage session={session} />
        </div>

        {chatOpen && (
          <div
            onMouseDown={startDrag}
            className="relative hidden w-1.5 flex-shrink-0 cursor-col-resize md:block"
          >
            <div className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 transition-colors hover:bg-[#3FA9C4]" />
          </div>
        )}

        <div
          className={`${chatOpen ? 'flex' : 'hidden'} mb-8 max-h-[40vh] w-full flex-shrink-0 flex-col overflow-hidden rounded-b-xl border-t border-[#DDE5E8] bg-[#F2F7F8] md:max-h-none md:w-[var(--chat-w)] md:flex-none md:self-stretch md:border-l md:border-t-0`}
          style={{ '--chat-w': `${chatWidth}px` } as CSSProperties}
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[#DDE5E8] px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#027495]">Chat</span>
            <button onClick={() => setChatOpen(false)} className="text-[#A9BAC0] hover:text-[#6E8388]" aria-label="Ocultar chat">
              ✕
            </button>
          </div>
          <ObserverChatPanel
            slug={slug}
            observerId={observer.observerId}
            chatOpen={chatOpen}
            onUnread={() => setUnreadCount((c) => c + 1)}
            onSessionState={(estado) => setSession((prev) => (prev ? { ...prev, estado: estado as PublicSession['estado'] } : prev))}
          />
        </div>
      </div>

      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full bg-[#027495] px-4 py-3 text-[13px] font-semibold text-white shadow-lg hover:bg-[#025F7A]"
        >
          <MessageSquare className="h-4 w-4" /> Abrir chat
          {unreadCount > 0 && (
            <span className="rounded-full bg-[#C4302B] px-1.5 py-0.5 text-[10px] font-bold leading-none">{unreadCount}</span>
          )}
        </button>
      )}
    </div>
  );
}

function ObserverChatPanel({
  slug, observerId, chatOpen, onUnread, onSessionState,
}: {
  slug: string; observerId: string; chatOpen: boolean;
  onUnread?: () => void; onSessionState?: (estado: string) => void;
}) {
  const [messages, setMessages] = useState<ObservationChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isPregunta, setIsPregunta] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showEmoji) return;
    const onClickOutside = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showEmoji]);
  // El chat nunca se desmonta al plegarse (ver comentario en el componente
  // padre) — este ref evita que el closure de onMessage, creado una sola vez
  // por useObservationChat, quede pegado al valor de chatOpen del primer render.
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  useEffect(() => {
    getObservationChatMessages({ slug, observerId }).then((res) => setMessages(res.messages ?? []));
  }, [slug, observerId]);

  useObservationChat({
    dependencyKey: observerId,
    getToken: () => getObservationChatToken({ slug, observerId }),
    onMessage: (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (!chatOpenRef.current) onUnread?.();
    },
    onDeleted: (id) => setMessages((prev) => prev.filter((m) => m.id !== id)),
    onSessionState,
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setInput('');
    const esPregunta = isPregunta;
    setIsPregunta(false); // el marcado es por mensaje, no queda pegado para el siguiente
    try {
      await postObserverChatMessage({ slug, observerId, body, esPregunta });
    } catch {
      // el mensaje simplemente no aparece; el observador puede reintentar
    }
    setSending(false);
  };

  return (
    <>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-xs italic text-[#A9BAC0]">Aún no hay mensajes.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-xs ${m.esPregunta ? 'rounded-r-lg border-l-2 border-[#3FA9C4] bg-[#027495]/[.08] py-1.5 pl-2.5 pr-2' : ''}`}
          >
            {m.esPregunta && (
              <div className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#027495]">
                Pregunta al moderador
              </div>
            )}
            <span className={`font-semibold ${m.esProductor ? 'text-[#027495]' : 'text-[#0F3D4C]'}`}>
              {m.nombre || 'Observador'}
              {m.esProductor && (
                <span className="ml-1 rounded bg-[#027495]/10 px-1 py-0.5 align-middle text-[9px] font-bold tracking-wide text-[#027495]">
                  SAPIENCE
                </span>
              )}
            </span>
            <span className="ml-1 text-[#A9BAC0]">
              {new Date(m.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <p className="break-words text-[#383838]">{m.body}</p>
          </div>
        ))}
      </div>
      <form
        onSubmit={handleSend}
        className="flex-shrink-0 border-t border-[#DDE5E8] px-3.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3.5"
      >
        <button
          type="button"
          onClick={() => setIsPregunta((v) => !v)}
          className={`mb-1.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
            isPregunta ? 'bg-[#027495] text-white' : 'bg-[#DDE5E8]/70 text-[#6E8388] hover:bg-[#DDE5E8]'
          }`}
        >
          <HelpCircle className="h-3 w-3" />
          Pregunta para el moderador
        </button>
        <div ref={emojiRef} className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isPregunta ? 'Escribe tu pregunta...' : 'Escribe un mensaje...'}
            className={`w-full rounded-[10px] border-[1.5px] py-2 pl-3 pr-9 text-xs text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:ring-[3px] ${
              isPregunta ? 'border-[#027495] ring-[3px] ring-[#027495]/[.13]' : 'border-[#DDE5E8] focus:border-[#027495] focus:ring-[#027495]/[.13]'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A9BAC0] hover:text-[#027495]"
            aria-label="Insertar emoji"
          >
            <Smile className="h-4 w-4" />
          </button>
          {showEmoji && (
            <div className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-lg shadow-lg">
              <Suspense
                fallback={
                  <div className="flex h-[350px] w-[280px] items-center justify-center bg-white text-xs text-[#A9BAC0]">
                    Cargando…
                  </div>
                }
              >
                <EmojiPicker
                  onEmojiClick={(emojiData) => {
                    setInput((v) => v + emojiData.emoji);
                    inputRef.current?.focus();
                  }}
                  width={280}
                  height={350}
                  skinTonesDisabled
                  previewConfig={{ showPreview: false }}
                  lazyLoadEmojis
                />
              </Suspense>
            </div>
          )}
        </div>
      </form>
    </>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2F7F8] px-4 text-center text-sm text-[#6E8388]">
      {children}
    </div>
  );
}

/**
 * Video + controles propios (play/pause, mute, pantalla completa) por
 * encima del mux-player, con look de Sapience en vez de la barra nativa.
 * `stream-type="live"` no tiene timeline que replicar — solo estos tres
 * controles, igual que pediría cualquier reproductor de un stream en vivo.
 * El tamaño se calcula por el ALTO disponible del contenedor (container
 * query, ver el `containerType: 'size'` del padre), no por un ancho tope:
 * así el video llena la pantalla en vez de quedarse chico con hueco vacío
 * alrededor, sin recortarse nunca (16:9 real, `min()` cede a lo ancho si la
 * ventana es angosta).
 */
function VideoStage({ session }: { session: PublicSession }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // En touch no hay hover real que revele los controles — se quedan siempre
  // visibles en vez de depender de un gesto que nunca llega.
  const [hovering, setHovering] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches,
  );

  const isLive = session.estado === 'vivo' && !!session.muxPlaybackId;

  useEffect(() => {
    const el = playerRef.current;
    if (!el || !isLive) return;
    // "playing" (no "play") es la señal de que en verdad hay cuadro en
    // pantalla — mux-player dispara "play" al INTENTAR reproducir, incluso
    // si el stream está caído y va a tronar en seguida, lo que dejaba los
    // controles escondidos para siempre en ese caso. Cualquier evento que
    // signifique "no se está viendo video ahorita" vuelve a mostrarlos.
    const onPlaying = () => setPaused(false);
    const onNotPlaying = () => setPaused(true);
    const onVolumeChange = () => setMuted(!!el.muted);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onNotPlaying);
    el.addEventListener('waiting', onNotPlaying);
    el.addEventListener('stalled', onNotPlaying);
    el.addEventListener('error', onNotPlaying);
    el.addEventListener('emptied', onNotPlaying);
    el.addEventListener('volumechange', onVolumeChange);
    return () => {
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onNotPlaying);
      el.removeEventListener('waiting', onNotPlaying);
      el.removeEventListener('stalled', onNotPlaying);
      el.removeEventListener('error', onNotPlaying);
      el.removeEventListener('emptied', onNotPlaying);
      el.removeEventListener('volumechange', onVolumeChange);
    };
  }, [isLive, session.muxPlaybackId]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  if (!isLive) {
    if (session.estado === 'terminada') {
      // El asset grabado tarda unos minutos en procesarse después de que el
      // live stream se apaga (ver el poll en el componente padre, que sigue
      // insistiendo hasta que `muxAssetPlaybackId` llega) — mientras tanto
      // no hay nada que reproducir, solo el aviso.
      if (session.muxAssetPlaybackId) {
        return (
          <div
            className="overflow-hidden rounded-xl bg-black shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
            style={{ width: 'min(100%, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' }}
          >
            {/* @ts-expect-error -- web component de @mux/mux-player, sin tipos de React/JSX */}
            <mux-player
              playback-id={session.muxAssetPlaybackId}
              stream-type="on-demand"
              controls
              style={{ width: '100%', height: '100%', '--media-object-fit': 'contain' }}
            />
          </div>
        );
      }
      return (
        <p className="px-6 text-center text-sm text-[#8FB6C0]">
          Esta sesión ya terminó. La grabación estará disponible en unos minutos.
        </p>
      );
    }
    // Cubre "esperando" (y cualquier otro caso sin playback listo): sin
    // esto, un observador que abre el link antes de que empiece se queda
    // viendo un player muerto.
    return <p className="px-6 text-center text-sm text-[#8FB6C0]">La sesión aún no comienza</p>;
  }

  const togglePlay = () => {
    const el = playerRef.current;
    if (!el) return;
    if (el.paused) el.play(); else el.pause();
  };
  const toggleMute = () => {
    const el = playerRef.current;
    if (!el) return;
    el.muted = !el.muted;
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen();
  };

  const controlsVisible = hovering || paused;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl bg-black shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
      style={{ width: 'min(100%, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(window.matchMedia && !window.matchMedia('(hover: hover)').matches)}
    >
      {/*
        @ts-expect-error -- web component de @mux/mux-player, sin tipos de React/JSX
        `--controls: none` apaga TODA la barra propia de mux-player (no solo
        el atributo `controls` nativo, que no la cubre) — sin esto, sus
        botones de play/volumen se veían encimados con los nuestros.
      */}
      <mux-player
        ref={playerRef}
        playback-id={session.muxPlaybackId}
        stream-type="live"
        autoplay muted
        style={{ width: '100%', height: '100%', '--media-object-fit': 'contain', '--controls': 'none' }}
      />

      {paused && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
          aria-label="Reproducir"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-[#027495]">
            <Play className="h-7 w-7 translate-x-0.5" />
          </span>
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        <button
          onClick={togglePlay}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-[#027495]"
          aria-label={paused ? 'Reproducir' : 'Pausar'}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleMute}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-[#027495]"
          aria-label={muted ? 'Activar audio' : 'Silenciar'}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <span className="ml-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/80">
          <span className="h-1.5 w-1.5 rounded-full bg-[#E0453C]" /> En vivo
        </span>
        <div className="flex-1" />
        <button
          onClick={toggleFullscreen}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-[#027495]"
          aria-label="Pantalla completa"
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function RegisterScreen({
  session, form, setForm, onSubmit, registering, error,
}: {
  session: PublicSession;
  form: RegisterFormValues;
  setForm: (updater: (f: RegisterFormValues) => RegisterFormValues) => void;
  onSubmit: (e: FormEvent) => void;
  registering: boolean;
  error: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {/* ── Mitad izquierda: la marca (mismo patrón que LoginPage.tsx) ── */}
      <div className="relative flex flex-none flex-col justify-between gap-5 overflow-hidden bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)] px-[26px] pb-[34px] pt-[30px] md:w-[42%] md:gap-0 md:px-[52px] md:py-14">
        <div className="pointer-events-none absolute -bottom-28 -right-24 hidden h-[380px] w-[380px] rounded-full border-[44px] border-[rgba(2,116,149,.16)] md:block" />

        <img src={LOGO_URL} alt="Sapience" className="relative z-10 h-auto w-[130px] md:w-[168px]" />

        <div className="relative z-10">
          <p className="max-w-none text-[19px] font-semibold leading-snug tracking-tight text-white md:max-w-[15ch] md:text-[27px]">
            {session.nombre}
          </p>
          {session.cliente && (
            <p className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#6FC2DA]">
              {session.cliente}
            </p>
          )}
        </div>
      </div>

      {/* ── Mitad derecha: el registro ── */}
      <div className="flex flex-1 items-center justify-center px-[26px] pb-14 pt-9 md:px-10 md:py-12">
        <form onSubmit={onSubmit} className="w-full max-w-[380px]">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#027495]">
            Sala de observación
          </span>
          <h1 className="mb-2 mt-2.5 text-[28px] font-bold leading-tight tracking-tight text-[#0F3D4C]">
            Regístrate para entrar
          </h1>
          <p className="mb-7 text-[15px] leading-relaxed text-[#6E8388]">
            Necesitamos tu nombre y correo antes de mostrarte la transmisión.
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6E8388]">Nombre</label>
              <input
                required autoFocus value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                className="w-full rounded-[10px] border-[1.5px] border-[#DDE5E8] px-4 py-3.5 text-[15px] text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:border-[#027495] focus:ring-[3px] focus:ring-[#027495]/[.13]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6E8388]">Apellido</label>
              <input
                required value={form.apellido}
                onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                className="w-full rounded-[10px] border-[1.5px] border-[#DDE5E8] px-4 py-3.5 text-[15px] text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:border-[#027495] focus:ring-[3px] focus:ring-[#027495]/[.13]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6E8388]">Correo</label>
              <input
                required type="email" placeholder="nombre@empresa.com" autoComplete="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={`w-full rounded-[10px] border-[1.5px] px-4 py-3.5 text-[15px] text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:border-[#027495] focus:ring-[3px] focus:ring-[#027495]/[.13] ${error ? 'border-[#C4302B]' : 'border-[#DDE5E8]'}`}
              />
            </div>
          </div>

          {error && (
            <div className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-[#C4302B]">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit" disabled={registering}
            className="mt-[18px] w-full rounded-[10px] bg-[#0F3D4C] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:enabled:bg-[#0A2F3B] active:enabled:translate-y-px disabled:cursor-default disabled:bg-[#93A9B0]"
          >
            {registering ? 'Entrando…' : 'Entrar a la sala'}
          </button>
        </form>
      </div>
    </div>
  );
}
