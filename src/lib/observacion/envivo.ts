// Video en vivo de la sala de observación (/s/:slug): cómo se mantiene al día cuando la pestaña se esconde o la red se atrasa, y la ventana flotante (imagen en imagen).
// Todo lo que se decide vive aquí, sin React ni navegador de verdad, para poder probarlo con un reproductor de mentira (server/scripts/test-sala-envivo.ts).
//
// Qué pasaba: los navegadores frenan las pestañas escondidas. El reproductor deja de bajar los pedazos de video a tiempo, se queda sin nada que mostrar y se detiene; al
// volver reanudaba donde se había quedado, así que el atraso crecía tanto como el tiempo que estuvo escondida (minutos, no los ~10 segundos normales).
//
// «Borde en vivo»: es el punto al que salta el botón «ir al vivo» de Mux y de Media Chrome: el FINAL de `seekable` (en una transmisión en vivo de Mux, el punto donde el
// reproductor reproduce normalmente). `liveEdgeStart` NO sirve de destino: es el INICIO de la zona de en vivo, el final de `seekable` menos tres veces la duración de un
// pedazo (unos 18 segundos con pedazos de 6), y saltar ahí dejaría a la persona esos segundos más atrasada. Solo se usa si `seekable` no está disponible.

/** Segundos entre una vigilancia del atraso y la siguiente. */
export const CADA_CUANTO_VIGILAR_MS = 5_000;
/** Atraso (segundos detrás del borde en vivo) a partir del cual se salta solo al vivo. */
export const ATRASO_MAXIMO_SEG = 25;
/** Si el atraso es de esto o menos, no vale la pena mover el video (evita saltitos inútiles al volver a la pestaña). */
export const ATRASO_MINIMO_PARA_SALTAR_SEG = 2;
/** Tiempo mínimo entre dos saltos automáticos de la vigilancia: si el borde en vivo no se deja alcanzar, no se brinca cada 5 segundos. */
export const ESPERA_ENTRE_SALTOS_MS = 15_000;

export interface RangosDeTiempo {
  readonly length: number;
  end(indice: number): number;
}

/** Lo mínimo del reproductor (el elemento `<mux-player>`) que usa la lógica; en las pruebas se sustituye por uno de mentira. */
export interface ReproductorEnVivo {
  currentTime: number;
  readonly paused: boolean;
  readonly seekable?: RangosDeTiempo | null;
  readonly liveEdgeStart?: number;
  play(): Promise<unknown> | void;
}

/** Lo que usa la lógica del `document` del navegador: visibilidad de la pestaña y ventana flotante. */
export interface DocumentoEnVivo {
  readonly hidden?: boolean;
  readonly visibilityState?: string;
  readonly pictureInPictureElement?: unknown;
  addEventListener(tipo: string, escucha: () => void): void;
  removeEventListener(tipo: string, escucha: () => void): void;
}

export interface Temporizador {
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const esNumero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** El borde en vivo (ver arriba): el final de `seekable`; si no hay, `liveEdgeStart`; si tampoco, nada. */
export function bordeEnVivo(el: Pick<ReproductorEnVivo, 'seekable' | 'liveEdgeStart'>): number | undefined {
  const rangos = el.seekable;
  if (rangos && rangos.length > 0) {
    const fin = rangos.end(rangos.length - 1);
    if (esNumero(fin)) return fin;
  }
  return esNumero(el.liveEdgeStart) ? el.liveEdgeStart : undefined;
}

/** Segundos que va detrás del borde en vivo (positivo = atrasado). Nada si todavía no hay reproducción que medir (sin borde o con el reloj en 0). */
export function atrasoEnSegundos(el: ReproductorEnVivo): number | undefined {
  const borde = bordeEnVivo(el);
  if (borde === undefined || !esNumero(el.currentTime) || el.currentTime <= 0) return undefined;
  return borde - el.currentTime;
}

/** Salta al borde en vivo si va más atrasado que `minimo` segundos. Devuelve si movió el video. */
export function irAlVivo(el: ReproductorEnVivo, minimo: number = ATRASO_MINIMO_PARA_SALTAR_SEG): boolean {
  const borde = bordeEnVivo(el);
  if (borde === undefined || !esNumero(el.currentTime)) return false;
  if (borde - el.currentTime <= minimo) return false;
  el.currentTime = borde;
  return true;
}

/** Pide reproducir sin que un rechazo del navegador (sin gesto, pestaña escondida, carga interrumpida) deje una promesa suelta. */
export function reanudar(el: ReproductorEnVivo): void {
  try {
    const r = el.play() as Promise<unknown> | void;
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
  } catch {
    // el navegador puede negarse; el siguiente intento (volver a la pestaña, la vigilancia o el botón) lo vuelve a pedir
  }
}

export interface OpcionesControlEnVivo {
  /** El reproductor de ahora (se pide en cada uso: el elemento puede cambiar). */
  obtenerReproductor: () => ReproductorEnVivo | null | undefined;
  documento: DocumentoEnVivo;
  temporizador?: Temporizador;
  ahora?: () => number;
  cadaMs?: number;
  atrasoMaximo?: number;
}

export interface ControlEnVivo {
  /** Empieza a escuchar la visibilidad de la pestaña y a vigilar el atraso. */
  iniciar(): void;
  detener(): void;
  /** El observador apretó pausa en el botón propio: se respeta hasta que apriete play. */
  pausarAProposito(): void;
  /** El observador apretó play: se va al borde en vivo (no sigue donde se quedó) y se reproduce. */
  reproducirAlVivo(): void;
  /** El video emitió `pause`. Dentro de la ventana flotante el navegador no pausa por su cuenta, así que es la persona con los controles de esa ventana. */
  alPausarseElVideo(): void;
  /** El video emitió `play`. Si lo apretó la persona en la ventana flotante después de una pausa, se va al vivo como con el botón propio. */
  alReproducirseElVideo(): void;
  alVolverALaPestana(): void;
  vigilar(): void;
  readonly pausadoAProposito: boolean;
}

export function crearControlEnVivo(op: OpcionesControlEnVivo): ControlEnVivo {
  const doc = op.documento;
  const reloj: Temporizador = op.temporizador ?? {
    setInterval: (f, ms) => globalThis.setInterval(f, ms),
    clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  };
  const ahora = op.ahora ?? (() => Date.now());
  const cadaMs = op.cadaMs ?? CADA_CUANTO_VIGILAR_MS;
  const atrasoMaximo = op.atrasoMaximo ?? ATRASO_MAXIMO_SEG;

  let pausadoAProposito = false;
  let ultimoSalto = Number.NEGATIVE_INFINITY;
  let idIntervalo: unknown;
  let iniciado = false;

  const escondida = () => doc.hidden === true || doc.visibilityState === 'hidden';
  const enVentanaFlotante = () => doc.pictureInPictureElement != null;

  const alVolverALaPestana = () => {
    if (escondida() || pausadoAProposito) return;
    const el = op.obtenerReproductor();
    if (!el) return;
    irAlVivo(el);
    reanudar(el);
  };

  const vigilar = () => {
    if (pausadoAProposito) return;
    // Con la pestaña escondida no hay nada que arreglar (se arregla al volver), salvo que el video siga corriendo en la ventana flotante.
    if (escondida() && !enVentanaFlotante()) return;
    const el = op.obtenerReproductor();
    if (!el) return;
    const atraso = atrasoEnSegundos(el);
    if (atraso === undefined || atraso <= atrasoMaximo) return;
    const t = ahora();
    if (t - ultimoSalto < ESPERA_ENTRE_SALTOS_MS) return;
    ultimoSalto = t;
    irAlVivo(el);
    if (el.paused) reanudar(el);
  };

  const reproducirAlVivo = () => {
    pausadoAProposito = false;
    const el = op.obtenerReproductor();
    if (!el) return;
    irAlVivo(el);
    reanudar(el);
  };

  return {
    iniciar() {
      if (iniciado) return;
      iniciado = true;
      doc.addEventListener('visibilitychange', alVolverALaPestana);
      idIntervalo = reloj.setInterval(vigilar, cadaMs);
    },
    detener() {
      if (!iniciado) return;
      iniciado = false;
      doc.removeEventListener('visibilitychange', alVolverALaPestana);
      reloj.clearInterval(idIntervalo);
    },
    pausarAProposito() { pausadoAProposito = true; },
    reproducirAlVivo,
    alPausarseElVideo() { if (enVentanaFlotante()) pausadoAProposito = true; },
    alReproducirseElVideo() { if (enVentanaFlotante() && pausadoAProposito) reproducirAlVivo(); },
    alVolverALaPestana,
    vigilar,
    get pausadoAProposito() { return pausadoAProposito; },
  };
}

// ── Ventana flotante (imagen en imagen) ──────────────────────────────────────

export interface VideoConVentana {
  requestPictureInPicture(): Promise<unknown>;
  readonly disablePictureInPicture?: boolean;
}

export interface DocumentoConVentana {
  readonly pictureInPictureEnabled?: boolean;
  readonly pictureInPictureElement?: unknown;
  exitPictureInPicture?(): Promise<void>;
}

/** El video interno del `<mux-player>` (`media.nativeEl`), que es el que sabe abrir la ventana flotante. Nada si todavía no existe o no la soporta. */
export function videoDe(reproductor: any): (VideoConVentana & EventTarget) | undefined {
  const video = reproductor?.media?.nativeEl ?? reproductor?.shadowRoot?.querySelector?.('video') ?? undefined;
  return video && typeof video.requestPictureInPicture === 'function' ? video : undefined;
}

/** El botón solo se ofrece donde el navegador permite la ventana flotante. */
export function puedeVentanaFlotante(doc: DocumentoConVentana, video?: VideoConVentana | null): boolean {
  if (doc.pictureInPictureEnabled !== true) return false;
  return !(video && video.disablePictureInPicture === true);
}

/** Abre la ventana flotante con este video, o la cierra si ya hay una. Devuelve si quedó abierta. El navegador puede negarla (sin gesto, sin datos): queda como estaba. */
export async function alternarVentanaFlotante(doc: DocumentoConVentana, video: VideoConVentana): Promise<boolean> {
  try {
    if (doc.pictureInPictureElement) await doc.exitPictureInPicture?.();
    else await video.requestPictureInPicture();
  } catch {
    // negada por el navegador: no hay nada que avisar, el botón refleja el estado real
  }
  // Ojo: con el reproductor de Mux el video vive dentro de un shadow DOM y `document.pictureInPictureElement` devuelve su ANFITRIÓN (el `<mux-player>`), no el `<video>`
  // (visto en el navegador): compararlo con el video diría siempre «cerrada». La página solo tiene este video, así que basta saber si hay alguno.
  return doc.pictureInPictureElement != null;
}
