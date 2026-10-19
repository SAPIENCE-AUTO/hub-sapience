// Reglas del latido de uso del Hub (panel «Actividad» de Configuración, solo Sergio): cuándo se considera que alguien está usando el Hub, cuántos
// segundos se le suman y cómo se evita contar doble cuando tiene varias ventanas abiertas. Viven aparte del hook (useActivityTracker) para poder
// probarlas con un reloj falso, sin navegador.

/** Cada cuánto se revisa si toca mandar un latido. */
export const BEAT_MS = 60_000;
/** Sin mouse, teclado, scroll ni toque por más de esto, la persona no está usando el Hub. */
export const IDLE_MS = 120_000;
/** Lo más que se suma de un golpe. Si pasó más (se durmió la compu, la pestaña estuvo congelada) es un hueco: no se cobra, solo se avisa. */
export const MAX_COBRO_S = 90;
/** Menos que esto no vale la pena mandarlo: otra ventana acaba de cobrar ese tramo. */
export const MIN_COBRO_S = 15;

export interface EstadoLatido {
  ahora: number;
  /** Cuándo se cobró (o se avisó) por última vez, en cualquiera de las ventanas de este navegador. */
  ultimoLatido: number;
  ultimaInteraccion: number;
  /** ¿La pestaña está a la vista? */
  visible: boolean;
}

/** Usando el Hub = pestaña a la vista y algo de mouse, teclado o scroll en los últimos 2 minutos. */
export const estaUsandoElHub = (e: Pick<EstadoLatido, 'ahora' | 'ultimaInteraccion' | 'visible'>): boolean => e.visible && e.ahora - e.ultimaInteraccion <= IDLE_MS;

/**
 * Qué mandar en este momento: los segundos corridos desde el último latido de cualquier ventana (cada una cobra solo el tramo que nadie ha cobrado,
 * así que dos ventanas abiertas no cuentan doble), 0 si hubo un hueco largo (solo avisa que está en línea; no cobra el rato en que nadie lo usaba) o
 * null si no hay nada que mandar (no lo está usando, o acaba de cobrar otra ventana).
 */
export function segundosACobrar(e: EstadoLatido): number | null {
  if (!estaUsandoElHub(e)) return null;
  const corridos = (e.ahora - e.ultimoLatido) / 1000;
  if (corridos > MAX_COBRO_S) return 0;
  if (corridos < MIN_COBRO_S) return null;
  return Math.round(corridos);
}

/** Tras un hueco largo el reloj compartido arranca de cero, para no cobrar después el rato en que nadie usaba el Hub. */
export const reiniciaElReloj = (ahora: number, ultimoLatido: number): boolean => ahora - ultimoLatido > MAX_COBRO_S * 1000;

export interface DepsRastreador {
  ahora: () => number;
  /** ¿La pestaña está a la vista? */
  visible: () => boolean;
  /** El último latido de cualquier ventana del navegador (localStorage); null si no hay o no se puede leer. */
  leerReloj: () => number | null;
  guardarReloj: (t: number) => void;
  /** Manda un latido al servidor: `segundos` 0 = solo avisa que está en línea, sin sumar tiempo. */
  enviar: (segundos: number) => void;
}

/**
 * El rastreador de uso de una ventana: recibe lo que pasa (interacciones, cambios de visibilidad, el tic cada minuto) y decide qué mandar.
 *  - Al abrir el Hub, al volver a la pestaña y al volver a tocar algo tras un rato sin hacerlo, avisa de inmediato (0 s): «en línea» sale al instante.
 *  - Cada minuto cobra lo corrido desde el último latido, no un minuto fijo; y al salir de la pestaña cobra el pedazo de minuto que llevaba.
 *  - El reloj es compartido entre las ventanas del navegador: dos ventanas visibles no suman el mismo tiempo dos veces.
 */
export function crearRastreadorDeUso(deps: DepsRastreador) {
  let ultimaInteraccion = deps.ahora();
  let respaldo = deps.ahora(); // el reloj de esta ventana, por si no hay localStorage
  const ultimo = () => deps.leerReloj() ?? respaldo;
  const fijar = (t: number) => { respaldo = t; deps.guardarReloj(t); };
  const mandar = (segundos: number) => { fijar(deps.ahora()); deps.enviar(segundos); };
  const estado = (visible: boolean): EstadoLatido => ({ ahora: deps.ahora(), ultimoLatido: ultimo(), ultimaInteraccion, visible });
  const avisar = () => {
    if (!deps.visible()) return;
    const ahora = deps.ahora();
    if (reiniciaElReloj(ahora, ultimo())) fijar(ahora);
    deps.enviar(0);
  };

  return {
    /** Al abrir el Hub. */
    abrir: avisar,
    /** Mouse, teclado, scroll o toque. */
    interaccion() {
      const ahora = deps.ahora();
      const volvia = ahora - ultimaInteraccion > IDLE_MS;
      ultimaInteraccion = ahora;
      if (volvia) avisar();
    },
    /** La pestaña pasó a estar a la vista (true) o dejó de estarlo (false). */
    visibilidad(visible: boolean) {
      if (visible) { avisar(); return; }
      const segundos = segundosACobrar(estado(true)); // hasta ahora estaba a la vista
      if (segundos !== null) mandar(segundos);
    },
    /** Cada BEAT_MS. */
    latido() {
      const segundos = segundosACobrar(estado(deps.visible()));
      if (segundos !== null) mandar(segundos);
    },
  };
}
