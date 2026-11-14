// Reglas puras del bloque «Talks» del evento del calendario (src/components/pm/TalksSessionPanel.tsx).
// Viven aparte, sin React ni llamadas al servidor, para poder probarlas (server/scripts/test-talks.ts).

/** Lo que la pantalla sabe de la sesión de Talks de un evento. */
export interface TalksSesionVista {
  talksSessionId: string;
  linkEquipo: string;
  linkParticipantes: string;
  /** «sin-llave»: Talks no tiene la llave de Mux de la sesión, así que EN VIVO no podría transmitir. */
  transmision?: 'lista' | 'sin-llave';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El botón de Talks solo aparece en un evento que ya está guardado, es decir, que ya tiene su id real. La forma es la que
 * acepta Postgres para un uuid (8-4-4-4-12 en hexadecimal), no la versión estándar estricta: una validación más dura
 * rechazaría ids que la base sí guarda. También la usan los dos endpoints, para que servidor y pantalla coincidan.
 */
export function esEventoGuardado(id: string | null | undefined): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/** Primera vez: «Crear links de sesión». Después: «Abrir en Talks». */
export function etiquetaBotonTalks(sesion: TalksSesionVista | null | undefined): string {
  return sesion ? 'Abrir en Talks' : 'Crear links de sesión';
}
