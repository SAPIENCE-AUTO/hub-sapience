// «Abrir en Talks» sin volver a pedir el correo: lo que pasa entre el clic y la ventana, sin React ni llamadas al servidor, para poder probarlo
// (server/scripts/test-talks-acceso.ts). Lo usan los DOS lugares donde está el botón: la ventana del evento (TalksSessionPanel.tsx) y la fila de la lista del
// calendario (TalksFilaCell.tsx), por medio de components/pm/abrirEnTalksReal.ts (que conecta esto con la ventana del navegador, el servidor y los avisos).
//
// Cómo funciona: el clic abre PRIMERO una ventana en blanco (si se abriera después de esperar al servidor, el navegador la bloquearía), se le pide al Hub un
// pase de un solo uso (getTalksAccessLink) y, cuando llega, se pone en esa ventana. Si algo falla (Talks dice que no, no responde, la respuesta no sirve), en esa
// MISMA ventana se abre el link normal del equipo (Talks pedirá el correo) y se avisa en español llano: nunca se queda atascado.

/** Lo que contesta getTalksAccessLink: la dirección con el pase, o el motivo por el que no hay. */
export interface ResultadoAcceso {
  url?: string;
  motivo?: 'no-encontrada' | 'sin-sesion' | 'no-disponible';
}

/** La ventana que se abrió en blanco con el clic. */
export interface VentanaTalks {
  navegar: (url: string) => void;
  cerrar: () => void;
}

/** Cuánto se le espera al Hub. El servidor ya le espera 8 segundos a Talks; esto cubre que el Hub mismo no conteste. */
export const ESPERA_ACCESO_PANTALLA_MS = 10_000;

/** El aviso de siempre cuando no se pudo entrar directo (cualquiera que sea el motivo): se abre el link normal y Talks pedirá el correo. */
export const AVISO_SIN_ENTRADA_DIRECTA = 'No pudimos entrar directo a Talks; te va a pedir tu correo.';
export const AVISO_VENTANA_BLOQUEADA = 'Tu navegador bloqueó la ventana nueva. Permite las ventanas emergentes de este sitio e inténtalo de nuevo.';
export const AVISO_LINK_NO_VALIDO = 'No se pudo abrir Talks: el link de esta sesión no es válido. Avisa a quien administra el Hub.';

/** Solo http(s): lo que se pone en una ventana nunca puede ser «javascript:» ni nada raro, venga de donde venga. */
export function esDireccionWeb(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  try {
    const u = new URL(valor);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export type ResultadoAbrir =
  /** Se abrió el pase: la persona entra directo. */
  | 'directo'
  /** Se abrió el link normal del equipo (Talks pedirá el correo) y se avisó por qué. */
  | 'link-normal'
  /** El navegador no dejó abrir la ventana: no se pidió ningún pase. */
  | 'bloqueada'
  /** El link normal tampoco servía: se cerró la ventana y se avisó. */
  | 'sin-link';

export interface DependenciasAbrir {
  /** El link normal del equipo (`linkEquipo`): el que se abre si el pase no llega. */
  linkEquipo: string;
  /** Abre la ventana en blanco; `null` si el navegador no la dejó abrir. Tiene que llamarse en el mismo instante del clic. */
  abrirVentana: () => VentanaTalks | null;
  /** Pide un pase NUEVO (cada clic pide el suyo: sirve una sola vez y vence en 60 segundos). */
  pedirAcceso: () => Promise<ResultadoAcceso>;
  avisar: (texto: string) => void;
  esperaMs?: number;
}

/** Espera la respuesta, pero no más de `esperaMs`: pasado ese tiempo es lo mismo que un «no». Un error de red también. */
async function conPlazo(pedir: () => Promise<ResultadoAcceso>, esperaMs: number): Promise<ResultadoAcceso> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<ResultadoAcceso>((ok) => { temporizador = setTimeout(() => ok({ motivo: 'no-disponible' }), esperaMs); });
  try {
    return await Promise.race([Promise.resolve().then(pedir).catch((): ResultadoAcceso => ({ motivo: 'no-disponible' })), plazo]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * El clic de «Abrir en Talks». Llamarlo sin ningún `await` antes (en el mismo instante del clic) para que el navegador deje abrir la ventana.
 * Nunca lanza: todo lo que sale mal termina en el link normal y un aviso.
 */
export async function abrirEnTalks(d: DependenciasAbrir): Promise<ResultadoAbrir> {
  const ventana = d.abrirVentana();
  if (!ventana) {
    d.avisar(AVISO_VENTANA_BLOQUEADA);
    return 'bloqueada';
  }

  const respuesta = await conPlazo(d.pedirAcceso, d.esperaMs ?? ESPERA_ACCESO_PANTALLA_MS);

  // La dirección del pase solo se usa si es web: aunque el servidor ya lo revisa, aquí se vuelve a revisar antes de ponerla en la ventana.
  if (esDireccionWeb(respuesta.url)) {
    ventana.navegar(respuesta.url);
    return 'directo';
  }

  if (esDireccionWeb(d.linkEquipo)) {
    ventana.navegar(d.linkEquipo);
    d.avisar(AVISO_SIN_ENTRADA_DIRECTA);
    return 'link-normal';
  }
  ventana.cerrar();
  d.avisar(AVISO_LINK_NO_VALIDO);
  return 'sin-link';
}
