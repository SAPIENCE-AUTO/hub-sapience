// Reglas puras del bloque «Talks» del evento del calendario (src/components/pm/TalksSessionPanel.tsx).
// Viven aparte, sin React ni llamadas al servidor, para poder probarlas (server/scripts/test-talks.ts).

/** Lo que la pantalla sabe de la sesión de Talks de un evento. */
export interface TalksSesionVista {
  talksSessionId: string;
  linkEquipo: string;
  linkParticipantes: string;
  /** Link de observación del cliente (`/s/<slug>`): lo muestra la fila de la lista del calendario junto a los dos de Talks. */
  observationUrl?: string;
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

const textoLleno = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Un evento de la lista (getTasks): trae muchos campos; aquí solo importan los de Talks. */
export interface EventoConTalks {
  talksSessionId?: unknown;
  talksLinkEquipo?: unknown;
  talksLinkParticipantes?: unknown;
  observationUrl?: unknown;
  [otroCampo: string]: unknown;
}

/**
 * Lo que la lista de eventos (getTasks) trae de Talks en cada evento, o `undefined` si todavía no tiene los links. Los tres datos
 * (id de la sesión y los dos links de Talks) tienen que venir completos: con uno solo vacío la fila vuelve a ofrecer «Crear links de sesión»,
 * que recupera lo que ya exista sin duplicar nada.
 */
export function talksDeEvento(ev: EventoConTalks | null | undefined): TalksSesionVista | undefined {
  if (!ev || !textoLleno(ev.talksSessionId) || !textoLleno(ev.talksLinkEquipo) || !textoLleno(ev.talksLinkParticipantes)) return undefined;
  return {
    talksSessionId: ev.talksSessionId,
    linkEquipo: ev.talksLinkEquipo,
    linkParticipantes: ev.talksLinkParticipantes,
    observationUrl: textoLleno(ev.observationUrl) ? ev.observationUrl : undefined,
  };
}

/**
 * Lo que muestra la fila: lo recién creado o consultado en esta pantalla (la ventana del evento y la fila se lo pasan una a la otra,
 * ver talksCompartido.ts) gana; lo que trajo la lista completa lo que falte (por ejemplo el link de observación).
 */
export function talksParaFila(ev: EventoConTalks | null | undefined, compartido: TalksSesionVista | undefined): TalksSesionVista | undefined {
  const delServidor = talksDeEvento(ev);
  if (!compartido) return delServidor;
  if (!delServidor) return compartido;
  return { ...delServidor, ...compartido, observationUrl: compartido.observationUrl ?? delServidor.observationUrl };
}

/** Uno de los links que la fila muestra con botón de copiar. */
export interface LinkDeTalks {
  /** Lo que dice el botón. */
  etiqueta: string;
  /** Cómo se llama en el aviso («Link de participantes copiado») y en el texto para lectores de pantalla. */
  nombre: string;
  valor: string;
}

/** Los links de la fila, en este orden: participantes y moderador (los dos de Talks) y, si ya se conoce, el de observación del cliente. */
export function linksDeTalks(talks: TalksSesionVista): LinkDeTalks[] {
  const links: LinkDeTalks[] = [
    { etiqueta: 'Participantes', nombre: 'Link de participantes', valor: talks.linkParticipantes },
    { etiqueta: 'Moderador', nombre: 'Link del moderador', valor: talks.linkEquipo },
  ];
  if (textoLleno(talks.observationUrl)) links.push({ etiqueta: 'Observación', nombre: 'Link de observación', valor: talks.observationUrl });
  return links;
}

/**
 * La frase del servidor si viene en español llano; si no (sin conexión, «Error interno», un «... falló (500)» de la capa de red), una genérica.
 * Reconoce el error del SDK de pantalla (`ApiError`) por su nombre, para no depender del SDK aquí y poder probarla.
 */
export function motivoDeError(err: unknown, generico: string): string {
  if (err instanceof Error && err.name === 'ApiError' && err.message && err.message !== 'Error interno' && !/ falló \(\d+\)$/.test(err.message)) return err.message;
  return generico;
}
