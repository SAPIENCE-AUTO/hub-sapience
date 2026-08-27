// ── Dedupe tracking ─────────────────────────────────────────────────────────
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

// ── Singleton Audio (preloaded once at module import) ────────────────────────
const DING_URL = 'https://files.catbox.moe/3l4s1x.mp3';

let _dingAudio: HTMLAudioElement | null = null;

function getDingAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!_dingAudio) {
    try {
      _dingAudio = new Audio(DING_URL);
      _dingAudio.volume = 0.7;
      _dingAudio.preload = 'auto';
      // Fire-and-forget load so the browser caches it
      _dingAudio.load();
    } catch {
      _dingAudio = null;
    }
  }
  return _dingAudio;
}

// Kick off preload immediately when the module is imported
getDingAudio();

// ── Audio unlock ─────────────────────────────────────────────────────────────
/**
 * Call this once after a user interaction (click, keypress, etc.) to unlock
 * the browser's autoplay policy for the ding audio.
 * Plays the singleton at volume 0 and immediately pauses — enough to satisfy Chrome.
 */
export function unlockAudio(): void {
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
function playDingFallback(): void {
  try {
    const CtxClass =
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      window.AudioContext;
    if (!CtxClass) return;
    const ctx = new CtxClass();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t = ctx.currentTime;

    // Primary tone: 830 Hz → 600 Hz
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(830, t);
    osc1.frequency.exponentialRampToValueAtTime(600, t + 0.08);
    gain1.gain.setValueAtTime(0.18, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.15);

    // Harmonic overtone: 1200 Hz → 900 Hz
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, t);
    osc2.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    gain2.gain.setValueAtTime(0.07, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.10);
  } catch { /* ignore */ }
}

/**
 * Plays the notification ding using the preloaded singleton Audio.
 * If the audio is already playing, rewinds to the start.
 * If the mp3 fails (blocked or unavailable), logs a warning and does nothing —
 * the Browser Notification with silent:false covers background sound.
 */
export function playChatDing(): void {
  const audio = getDingAudio();
  if (audio) {
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {
        console.warn('Chat ding failed — mp3 not available or blocked');
      });
      return;
    } catch {
      console.warn('Chat ding failed — mp3 not available or blocked');
    }
  }
}

// ── Browser notification ─────────────────────────────────────────────────────
export type ChatNotificationPayload = {
  channel: string;
  messageId?: string;
  senderName?: string;
  hasMention: boolean;
};

/**
 * Shows a browser Notification.
 * Skips only if the user is actively viewing the same channel.
 * Does nothing if permission has not been granted.
 *
 * silent strategy:
 *  - Tab focused  → silent: true  (custom ding already played)
 *  - Tab blurred  → silent: false (OS native sound acts as fallback
 *                                  in case Chrome blocks Audio.play())
 */
export function showChatBrowserNotification(payload: ChatNotificationPayload, activeChannel?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (activeChannel && activeChannel === payload.channel) return;
  try {
    const tabFocused = document.hasFocus();
    const title = `${payload.senderName ?? 'Nuevo mensaje'} en #${payload.channel}`;
    const body = payload.hasMention ? '💬 Te mencionaron en este canal' : '💬 Nuevo mensaje';
    const notif = new Notification(title, {
      body,
      tag: `chat-${payload.channel}`,
      // Sin esto, mensajes seguidos en el mismo canal comparten tag y el
      // navegador solo "alerta" (sonido/aparición) la primera vez — las
      // siguientes actualizan el contenido en silencio. Si la que se pierde
      // así es justo la que te menciona, no te enteras.
      renotify: true,
      silent: tabFocused, // true when focused (custom ding covers it), false when in background
    });
    notif.onclick = () => { window.focus(); notif.close(); };
    setTimeout(() => notif.close(), 6000);
  } catch { /* ignore */ }
}
