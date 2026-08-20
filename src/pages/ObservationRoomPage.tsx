import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  getObservationRoomPublic, registerObserver, getObservationChatMessages,
  getObservationChatToken, postObserverChatMessage, postObserverHeartbeat,
} from 'zite-endpoints-sdk';
import { useObservationChat, type ObservationChatMessage } from '@/hooks/useObservationChat';
import '@mux/mux-player';

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

  // Poll cada 15s mientras "esperando" — mismo patrón que el resto del Hub
  // (setInterval + guard de visibilidad; ver SupplierInvoicesPage.tsx).
  useEffect(() => {
    if (session?.estado !== 'esperando') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.estado, slug]);

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
    <div className="flex min-h-screen flex-col bg-[#F2F7F8]">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#0F3D4C] px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src={LOGO_URL} alt="Sapience" className="hidden h-4 w-auto flex-shrink-0 sm:block" />
          <div className="min-w-0 border-l border-white/15 pl-3 sm:pl-3">
            <h1 className="truncate text-sm font-semibold text-white">{session.nombre}</h1>
            {session.cliente && <p className="truncate text-[11px] text-[#8FB6C0]">{session.cliente}</p>}
          </div>
        </div>
        <button onClick={handleNotMe} className="flex-shrink-0 text-[11px] text-[#8FB6C0] hover:text-white">
          no soy {observer.nombre}
        </button>
      </header>

      {/* Video protagonista pero acotado (no pantalla completa) — 16:9 real,
          centrado, con un tope de ancho para que no se sienta gigante en
          monitores grandes. Chat como columna angosta fija al lado, no un
          overlay: siempre visible, sin colapsar. */}
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-3 p-3 md:flex-row md:items-start md:justify-center md:gap-4 md:p-4">
        <div className="flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-sm md:max-w-4xl">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[#DDE5E8] px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6E8388]">Transmisión</span>
            {session.estado && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${estadoBadge[session.estado] ?? 'bg-[#F2F7F8] text-[#0F3D4C]'}`}>
                {estadoLabel[session.estado] ?? session.estado}
              </span>
            )}
          </div>
          <div className="flex aspect-video w-full items-center justify-center bg-[#0A2F3B]">
            <RoomStage session={session} />
          </div>
        </div>

        <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm md:w-[340px] md:flex-none md:self-stretch">
          <div className="flex-shrink-0 border-b border-[#DDE5E8] px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#027495]">Chat</span>
          </div>
          <ObserverChatPanel
            slug={slug}
            observerId={observer.observerId}
            onSessionState={(estado) => setSession((prev) => (prev ? { ...prev, estado: estado as PublicSession['estado'] } : prev))}
          />
        </div>
      </div>
    </div>
  );
}

function ObserverChatPanel({
  slug, observerId, onSessionState,
}: { slug: string; observerId: string; onSessionState?: (estado: string) => void }) {
  const [messages, setMessages] = useState<ObservationChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getObservationChatMessages({ slug, observerId }).then((res) => setMessages(res.messages ?? []));
  }, [slug, observerId]);

  useObservationChat({
    dependencyKey: observerId,
    getToken: () => getObservationChatToken({ slug, observerId }),
    onMessage: (msg) => setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])),
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
    try {
      await postObserverChatMessage({ slug, observerId, body });
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
          <div key={m.id} className="text-xs">
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
      <form onSubmit={handleSend} className="flex-shrink-0 border-t border-[#DDE5E8] p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="w-full rounded-[10px] border-[1.5px] border-[#DDE5E8] px-3 py-2 text-xs text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:border-[#027495] focus:ring-[3px] focus:ring-[#027495]/[.13]"
        />
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

function RoomStage({ session }: { session: PublicSession }) {
  if (session.estado === 'vivo' && session.muxPlaybackId) {
    return (
      // @ts-expect-error -- web component de @mux/mux-player, sin tipos de React/JSX
      <mux-player
        playback-id={session.muxPlaybackId}
        stream-type="live"
        style={{ width: '100%', height: '100%', '--media-object-fit': 'contain' }}
      />
    );
  }
  // Cubre tanto "esperando" como "terminada" (y cualquier otro caso sin
  // playback listo): sin esto, un observador que abre el link al día
  // siguiente de que la sesión terminó se queda viendo un player muerto.
  const message = session.estado === 'terminada' ? 'Esta sesión ya terminó' : 'La sesión aún no comienza';
  return <p className="px-6 text-center text-sm text-[#8FB6C0]">{message}</p>;
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
