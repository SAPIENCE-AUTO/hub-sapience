import { construirNotificacion, notificacionSilenciosa, type AvisoMensaje } from './chatAvisos';

// Aquí vive lo que TOCA el navegador: el sonido, la notificación del escritorio y qué tan «a la vista» está la ventana. Las reglas de cuándo avisar y con qué texto
// están en chatAvisos.ts (sin DOM, con pruebas).

// ── Aviso doble ─────────────────────────────────────────────────────────────
const playedIds = new Map<string, number>(); // messageId → timestamp played
const DEDUPE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Returns true if this messageId should trigger a ding (first time seen within 2 min).
 * Automatically prunes expired entries.
 */
export function shouldPlayDing(messageId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of playedIds.entries()) {
    if (now - ts > DEDUPE_TTL_MS) playedIds.delete(id);
  }
  if (playedIds.has(messageId)) return false;
  playedIds.set(messageId, now);
  return true;
}

// ── ¿La persona está viendo el Hub? ─────────────────────────────────────────
/** La ventana está a la vista (no es una pestaña escondida ni una ventana minimizada) y tiene el foco (la persona no está escribiendo en otra aplicación). */
export function ventanaALaVista(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
}

// ── Mensajes que llegaron mientras la persona no miraba (solo para el título de la pestaña) ──
// Un mensaje del canal abierto no se suma a los no leídos (ya está en la pantalla del chat), pero si llegó con la ventana fuera de la vista, el título de la
// pestaña tiene que avisarlo hasta que la persona regrese.
let mensajesFuera = 0;
let mencionFuera = false;

export function registrarMensajeMientrasFuera(conMencion: boolean): void {
  mensajesFuera += 1;
  if (conMencion) mencionFuera = true;
  window.dispatchEvent(new CustomEvent('chat-away-updated'));
}

export function mensajesMientrasFuera(): { total: number; conMencion: boolean } {
  return { total: mensajesFuera, conMencion: mencionFuera };
}

export function limpiarMensajesMientrasFuera(): void {
  if (mensajesFuera === 0 && !mencionFuera) return;
  mensajesFuera = 0;
  mencionFuera = false;
  window.dispatchEvent(new CustomEvent('chat-away-updated'));
}

// ── Sonido ──────────────────────────────────────────────────────────────────
// El sonido es el mp3 que eligió Sergio («New Message Notification»), guardado DENTRO del Hub (public/sounds/ding.mp3) y no en un servicio de terceros. Antes
// vivía en files.catbox.moe, un sitio gratuito de archivos: todos los usuarios lo descargaban al abrir el Hub aunque no usaran el chat, y si el sitio lo borraba,
// se caía o una red o un bloqueador de anuncios lo cortaba, el chat se quedaba sin sonido sin avisar. Para ese caso (el archivo no carga o no se puede
// decodificar) queda un respaldo generado con Web Audio: es un tono simple, MUCHO menos agradable que el mp3, y solo está para que el chat no se quede mudo.
const DING_URL = '/sounds/ding.mp3';
const VOLUMEN_DING = 0.7;

let _dingAudio: HTMLAudioElement | null = null;
let _dingRoto = false; // el archivo no cargó o no se puede decodificar: de aquí en adelante suena el respaldo

function getDingAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || _dingRoto) return null;
  if (!_dingAudio) {
    try {
      const audio = new Audio(DING_URL);
      audio.volume = VOLUMEN_DING;
      audio.preload = 'auto';
      audio.addEventListener('error', () => { _dingRoto = true; _dingAudio = null; });
      // Fire-and-forget load so the browser caches it
      audio.load();
      _dingAudio = audio;
    } catch {
      _dingAudio = null;
      _dingRoto = true;
    }
  }
  return _dingAudio;
}

// Kick off preload immediately when the module is imported
getDingAudio();

// Un solo contexto de Web Audio para todos los respaldos: crear uno nuevo por cada aviso (como se hacía) se acumula y el navegador deja de dar más.
let _ctx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (_ctx && _ctx.state !== 'closed') return _ctx;
  const Ctor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { _ctx = new Ctor(); } catch { _ctx = null; }
  return _ctx;
}

// ── Audio unlock ─────────────────────────────────────────────────────────────
/**
 * Call this once after a user interaction (click, keypress, etc.) to unlock
 * the browser's autoplay policy for the ding audio.
 * Plays the singleton at volume 0 and immediately pauses — enough to satisfy Chrome.
 * También crea y despierta el contexto de Web Audio del respaldo, que solo se puede hacer con un gesto real.
 */
export function unlockAudio(): void {
  getAudioContext()?.resume().catch(() => {});
  const audio = getDingAudio();
  if (!audio) return;
  try {
    const prev = audio.volume;
    audio.volume = 0;
    audio.play()
      .then(() => { audio.pause(); audio.currentTime = 0; audio.volume = prev; })
      .catch(() => { audio.volume = prev; });
  } catch { /* ignore */ }
}

// ── Audio playback ───────────────────────────────────────────────────────────
// Una nota del respaldo: seno que baja de `de` a `a` Hz en `barrido` segundos y se apaga en `dura` segundos.
function nota(ctx: AudioContext, t: number, o: { de: number; a: number; barrido: number; dura: number; volumen: number }): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(o.de, t);
  osc.frequency.exponentialRampToValueAtTime(o.a, t + o.barrido);
  gain.gain.setValueAtTime(o.volumen, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + o.dura);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + o.dura);
}

function tocarRespaldo(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    nota(ctx, t, { de: 830, a: 600, barrido: 0.08, dura: 0.15, volumen: 0.45 }); // tono principal
    nota(ctx, t, { de: 1200, a: 900, barrido: 0.06, dura: 0.10, volumen: 0.17 }); // armónico
  } catch { /* ignore */ }
}

/**
 * Plays the notification ding using the preloaded singleton Audio.
 * If the audio is already playing, rewinds to the start.
 * Si el archivo no cargó o no se puede reproducir, suena el respaldo generado con Web Audio (antes aquí no sonaba nada y solo quedaba un aviso en la consola).
 * Si lo que pasa es que el navegador bloquea el audio hasta que la persona toque la página (NotAllowedError), NO se sustituye por el respaldo: sonaría un tono
 * distinto del que eligió la persona y, con el mismo bloqueo, tampoco sonaría; para eso queda el sonido de la notificación del escritorio.
 */
export function playChatDing(): void {
  const audio = getDingAudio();
  if (!audio) { tocarRespaldo(); return; }
  try {
    audio.currentTime = 0;
    const reproduccion = audio.play();
    if (reproduccion && typeof reproduccion.catch === 'function') {
      reproduccion.catch((err: unknown) => {
        if ((err as { name?: string } | null)?.name === 'NotAllowedError') return;
        tocarRespaldo();
      });
    }
  } catch {
    tocarRespaldo();
  }
}

// ── Browser notification ─────────────────────────────────────────────────────
export type ChatNotificationPayload = AvisoMensaje;

/**
 * Muestra la notificación del escritorio (si la persona dio permiso). El texto sale de construirNotificacion; el clic trae la ventana al frente y llama a
 * `alAbrir` (el Hub abre esa conversación). Sin sonido si la campana del chat está apagada o si el Hub ya suena porque la persona está mirando la ventana;
 * con la ventana fuera de la vista y la campana encendida, el sistema operativo hace sonar su propio aviso (respaldo por si el navegador no deja reproducir
 * el del Hub).
 */
export function showChatBrowserNotification(payload: ChatNotificationPayload, opciones: { sonidoActivo: boolean; alAbrir?: () => void }): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const { titulo, cuerpo } = construirNotificacion(payload);
    const notif = new Notification(titulo, {
      body: cuerpo,
      tag: `chat-${payload.channel}`,
      // Sin esto, mensajes seguidos en el mismo canal comparten tag y el
      // navegador solo "alerta" (sonido/aparición) la primera vez — las
      // siguientes actualizan el contenido en silencio. Si la que se pierde
      // así es justo la que te menciona, no te enteras.
      renotify: true,
      silent: notificacionSilenciosa({ sonidoActivo: opciones.sonidoActivo, mirando: ventanaALaVista() }),
    });
    notif.onclick = () => { window.focus(); notif.close(); opciones.alAbrir?.(); };
    setTimeout(() => notif.close(), 6000);
  } catch { /* ignore */ }
}
