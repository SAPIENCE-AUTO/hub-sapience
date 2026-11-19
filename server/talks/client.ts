/**
 * Cliente de Talks, la app de sesiones en vivo con participantes (repositorio aparte, `talks.mx`).
 *
 * Contrato completo: `docs/integracion-hub.md` del repositorio de Talks. El Hub le habla con una llave
 * compartida (`Authorization: Bearer`): TALKS_API_KEY aquí es la misma HUB_API_KEY que vive en Render
 * del lado de Talks.
 *
 * Variables de entorno:
 *   TALKS_URL      — dirección base de Talks, sin barra final (https://talks.mx). Solo se acepta http
 *                    en localhost (pruebas): la llave no debe viajar sin cifrar a ningún otro lado.
 *   TALKS_API_KEY  — la llave compartida. Nunca va en un archivo versionado ni en el chat.
 *
 * Seguridad: la llave de transmisión de Mux (`muxStreamKey`) es la única credencial que permite
 * transmitir a la sala del evento. Solo viaja en el cuerpo del POST de `crearSesionTalks`; nunca en una
 * URL ni en un registro, y todo texto que venga de Talks se limpia de ella (y de la llave del Hub)
 * antes de mostrarse o anotarse. Talks tampoco la devuelve nunca.
 *
 * Los mensajes de error están en español llano porque llegan tal cual a la pantalla de quien aprieta
 * el botón (ver aZiteError en src/serverUtils/talksSession.ts).
 *
 * Acceso directo (`pedirAccesoEquipoTalks`): el pase que Talks da para entrar sin volver a pedir el correo vale
 * 60 segundos y sirve una sola vez. No se guarda, no se cachea y no se escribe en registros (ni la dirección ni
 * la respuesta de Talks); el correo que se manda es siempre el de la sesión del Hub.
 */

import { z } from 'zod';

export type TalksErrorTipo = 'sin-configurar' | 'llave-rechazada' | 'datos-invalidos' | 'no-disponible' | 'respuesta-rara';

export class TalksError extends Error {
  tipo: TalksErrorTipo;
  constructor(tipo: TalksErrorTipo, mensaje: string) {
    super(mensaje);
    this.name = 'TalksError';
    this.tipo = tipo;
  }
}

/** Una sesión de Talks tal como la entiende el Hub (sin nada que no se use). */
export interface TalksSesion {
  id: string;
  linkEquipo: string;
  linkParticipantes: string;
  yaExistia: boolean;
  /** «lista»: Talks tiene la llave de Mux de esta sesión. «sin-llave»: no la tiene, así que EN VIVO no podría transmitir. */
  transmision?: 'lista' | 'sin-llave';
}

// Cuánto se espera a Talks. Crear puede tardar si Talks estaba dormido (Render lo apaga por inactividad);
// consultar corre de fondo y no debe colgar la pantalla.
const ESPERA_CREAR_MS = 40_000;
const ESPERA_CONSULTAR_MS = 15_000;
// El pase de acceso directo lo espera una ventana en blanco: pasado este tiempo la pantalla abre el link de siempre (ver pedirAccesoEquipoTalks).
export const ESPERA_ACCESO_MS = 8_000;

const soloHttp = (u: string) => /^https?:\/\//i.test(u);
const esHostLocal = (host: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

const RespuestaTalks = z.object({
  id: z.string().min(1),
  // Los links van a un <a href> en el Hub: solo http(s), nunca «javascript:» ni nada raro.
  linkEquipo: z.string().refine(soloHttp),
  linkParticipantes: z.string().refine(soloHttp),
  yaExistia: z.boolean().optional(),
  transmision: z.string().optional(),
});

function leerConfig(): { base: string; llave: string } {
  const base = (process.env.TALKS_URL ?? '').trim().replace(/\/+$/, '');
  const llave = (process.env.TALKS_API_KEY ?? '').trim();
  if (!base || !llave) {
    throw new TalksError('sin-configurar', 'Talks todavía no está conectado al Hub: falta configurar su dirección y su llave en el servidor.');
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new TalksError('sin-configurar', 'La dirección de Talks (TALKS_URL) no es válida.');
  }
  const local = esHostLocal(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new TalksError('sin-configurar', 'La dirección de Talks (TALKS_URL) debe empezar con https://.');
  }
  return { base, llave };
}

/**
 * Falla con un mensaje claro si las dos variables no están puestas o están mal formadas (sin llamar a Talks).
 * Quien crea cosas (la transmisión de Mux) lo llama antes: sin Talks conectado no debe quedar nada a medias.
 */
export function exigirTalksConfigurado(): void {
  leerConfig();
}

/** Tapa las credenciales en un texto que vino de fuera, por si Talks (o un proxy) las repitiera. */
function limpiar(texto: string, secretos: string[]): string {
  let t = texto;
  for (const s of secretos) if (s && s.length >= 4) t = t.split(s).join('••••');
  return t;
}

interface Llamada { method: 'GET' | 'POST'; cuerpo?: unknown; esperaMs: number; secretos: string[] }
interface Respuesta { status: number; json: unknown; texto: string }

async function llamar(ruta: string, { method, cuerpo, esperaMs, secretos }: Llamada): Promise<Respuesta> {
  const { base, llave } = leerConfig();
  const todosLosSecretos = [...secretos, llave];

  let res: Response;
  try {
    res = await fetch(`${base}${ruta}`, {
      method,
      headers: {
        Authorization: `Bearer ${llave}`,
        Accept: 'application/json',
        ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(esperaMs),
      // Una redirección volvería a mandar el cuerpo (con la llave de Mux) a otra dirección: no se sigue.
      redirect: 'manual',
    });
  } catch {
    // Sin conexión, nombre que no existe o demasiado lento. Se omite el detalle técnico a propósito.
    throw new TalksError('no-disponible', 'Talks no respondió. Intenta de nuevo en un minuto; no se crea nada doble.');
  }

  if (res.status >= 300 && res.status < 400) {
    throw new TalksError('sin-configurar', 'Talks contestó con una redirección: revisa que TALKS_URL sea la dirección final de Talks.');
  }

  let texto = '';
  try { texto = await res.text(); } catch { /* sin cuerpo */ }
  let json: unknown = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  return { status: res.status, json, texto: limpiar(texto.slice(0, 300), todosLosSecretos) };
}

/** Lo que Talks diga del problema, si lo dice en un campo de texto conocido. */
function detalleDe(r: Respuesta): string {
  const j = r.json as Record<string, unknown> | null;
  const candidato = j && typeof j === 'object' ? (j.error ?? j.message ?? j.mensaje) : undefined;
  return typeof candidato === 'string' ? candidato.trim().slice(0, 200) : '';
}

/** Traduce los códigos de error de Talks a frases claras. Devuelve el error; quien llama decide si lo lanza. */
function errorDe(r: Respuesta, secretos: string[]): TalksError {
  const detalle = limpiar(detalleDe(r), [...secretos, (process.env.TALKS_API_KEY ?? '').trim()]);
  if (r.status === 400) {
    return new TalksError('datos-invalidos', detalle
      ? `Talks rechazó los datos de la sesión: ${detalle}`
      : 'Talks rechazó los datos de la sesión (por ejemplo el nombre o la llave de transmisión).');
  }
  if (r.status === 401 || r.status === 403) {
    return new TalksError('llave-rechazada', 'Talks no aceptó la llave del Hub: TALKS_API_KEY no coincide con la llave de Talks. Avisa a quien administra el Hub.');
  }
  if (r.status === 404) {
    return new TalksError('sin-configurar', 'Talks no reconoce esa dirección: revisa que TALKS_URL sea la correcta.');
  }
  if (r.status === 429) {
    return new TalksError('no-disponible', 'Talks pide esperar un momento. Intenta de nuevo en un minuto.');
  }
  if (r.status >= 500) {
    return new TalksError('no-disponible', 'Talks no está disponible en este momento. Intenta de nuevo en un minuto; no se crea nada doble.');
  }
  return new TalksError('respuesta-rara', `Talks contestó algo inesperado (código ${r.status}). Avisa a quien administra el Hub.`);
}

function leerSesion(r: Respuesta): TalksSesion {
  const ok = RespuestaTalks.safeParse(r.json);
  if (!ok.success) {
    throw new TalksError('respuesta-rara', 'Talks contestó algo que el Hub no entiende. Avisa a quien administra el Hub.');
  }
  const d = ok.data;
  return {
    id: d.id,
    linkEquipo: d.linkEquipo,
    linkParticipantes: d.linkParticipantes,
    // Si Talks no lo dice, vale lo que dice el código: 200 = ya existía, 201 = nueva.
    yaExistia: d.yaExistia ?? r.status === 200,
    transmision: d.transmision === 'lista' || d.transmision === 'sin-llave' ? d.transmision : undefined,
  };
}

export interface CrearSesionTalks {
  nombre: string;
  externoId: string;
  muxStreamKey: string;
  /** Solo https (Talks la rechaza si no): quien llama la omite cuando no lo es. Es informativa. */
  observacionUrl?: string;
}

/**
 * POST /api/v1/sesiones. Crea la sesión del evento o, si ya existía una (mismo `externoId`), la
 * actualiza y la devuelve: apretar dos veces no crea nada doble.
 */
export async function crearSesionTalks(datos: CrearSesionTalks): Promise<TalksSesion> {
  const r = await llamar('/api/v1/sesiones', {
    method: 'POST',
    cuerpo: {
      nombre: datos.nombre,
      externoId: datos.externoId,
      muxStreamKey: datos.muxStreamKey,
      ...(datos.observacionUrl ? { observacionUrl: datos.observacionUrl } : {}),
    },
    esperaMs: ESPERA_CREAR_MS,
    secretos: [datos.muxStreamKey],
  });
  if (r.status === 200 || r.status === 201) return leerSesion(r);
  throw errorDe(r, [datos.muxStreamKey]);
}

/** GET /api/v1/sesiones/evento/{externoId}. Devuelve null si el evento todavía no tiene sesión en Talks. Nunca crea nada. */
export async function consultarSesionTalks(externoId: string): Promise<TalksSesion | null> {
  const r = await llamar(`/api/v1/sesiones/evento/${encodeURIComponent(externoId)}`, {
    method: 'GET',
    esperaMs: ESPERA_CONSULTAR_MS,
    secretos: [],
  });
  if (r.status === 200) return leerSesion(r);
  // Por contrato, 404 aquí es «este evento todavía no tiene sesión». Si en realidad TALKS_URL estuviera mal,
  // se nota en el POST de crear, que sí distingue un 404 como dirección equivocada (ver errorDe).
  if (r.status === 404) return null;
  throw errorDe(r, []);
}

/**
 * Por qué no se pudo conseguir el pase de acceso directo. La pantalla abre el link normal del equipo en todos los casos, con el mismo aviso:
 *   «no-encontrada»: Talks no conoce la sesión (404); «no-disponible»: cualquier otra cosa (llave mala, datos mal formados, un 403 inesperado, Talks caído
 *   o sin responder, una respuesta que no sirve). Talks ya NO tiene una lista aparte de quién puede entrar con el pase (no revisa EQUIPO_PERMITIDO para
 *   quien llega así): quién entra lo decide el Hub, en getTalksAccessLink.
 */
export type AccesoMotivo = 'no-encontrada' | 'no-disponible';
/** `estado` es solo para el registro del servidor (un código HTTP o una palabra): nunca incluye la dirección del pase, el correo ni el cuerpo de la respuesta. */
export type AccesoTalks = { ok: true; url: string } | { ok: false; motivo: AccesoMotivo; estado: number | string };

export interface PedirAccesoEquipo {
  /** El correo de quien aprieta el botón, tomado SIEMPRE de la sesión ya verificada del Hub (context.user.email), nunca de lo que mande el navegador. */
  email: string;
  /** Opcional (hasta 60 caracteres): si falta, Talks lo arma con el correo. */
  nombre?: string;
  /** El id de la sesión de Talks (`talks_session_id`): si falta, la persona llega al inicio de Talks. */
  sesionId?: string;
  /** Otras direcciones donde puede vivir el pase además de TALKS_URL: las de los links que Talks ya dio para esa sesión. */
  direccionesDeTalks?: string[];
  esperaMs?: number;
}

/**
 * La dirección del pase solo se entrega si es de Talks (TALKS_URL o la de los links que Talks dio para esa sesión) y viaja cifrada (https; http solo en localhost).
 * La pantalla la pone tal cual en una ventana: nada de «javascript:» ni de otro sitio, aunque Talks se equivocara.
 */
function direccionDelPase(texto: string, direcciones: string[]): string | null {
  let u: URL;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && esHostLocal(u.hostname))) return null;
  const esDeTalks = direcciones.some((d) => { try { return new URL(d).origin === u.origin; } catch { return false; } });
  return esDeTalks ? u.href : null;
}

/**
 * POST /api/v1/acceso-equipo. Cambia el correo de quien ya inició sesión en el Hub por un pase de UN solo uso (vale 60 segundos) que lo deja entrar directo
 * a la consola de la sesión de Talks, sin volver a pedirle su correo. Nunca lanza por un problema de Talks: devuelve el motivo para que la pantalla abra
 * el link normal. El pase va en la parte `#` de la dirección a propósito (no llega a ningún servidor ni a los registros): NO se guarda, NO se escribe en
 * registros (ni la dirección ni el cuerpo de la respuesta) y se pide uno nuevo en cada clic.
 */
export async function pedirAccesoEquipoTalks(datos: PedirAccesoEquipo): Promise<AccesoTalks> {
  let config: { base: string; llave: string };
  try { config = leerConfig(); } catch { return { ok: false, motivo: 'no-disponible', estado: 'sin-configurar' }; }

  const email = datos.email.trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, motivo: 'no-disponible', estado: 'sin-correo' };
  const nombre = datos.nombre?.trim().slice(0, 60);

  let r: Respuesta;
  try {
    r = await llamar('/api/v1/acceso-equipo', {
      method: 'POST',
      cuerpo: { email, ...(nombre ? { nombre } : {}), ...(datos.sesionId ? { sesionId: datos.sesionId } : {}) },
      esperaMs: datos.esperaMs ?? ESPERA_ACCESO_MS,
      secretos: [],
    });
  } catch {
    // Sin conexión, demasiado lento (más de ESPERA_ACCESO_MS) o una redirección: la pantalla abre el link normal.
    return { ok: false, motivo: 'no-disponible', estado: 'sin-respuesta' };
  }

  if (r.status === 200 || r.status === 201) {
    const ok = z.object({ url: z.string().min(1).max(2000) }).safeParse(r.json);
    const url = ok.success ? direccionDelPase(ok.data.url, [config.base, ...(datos.direccionesDeTalks ?? [])]) : null;
    return url ? { ok: true, url } : { ok: false, motivo: 'no-disponible', estado: 'respuesta-rara' };
  }
  if (r.status === 404) return { ok: false, motivo: 'no-encontrada', estado: r.status };
  // 401 (llave mala), 400 (datos mal formados), 403 u otro código inesperado, 5xx: el link normal y el aviso general. El código queda en el registro del servidor.
  return { ok: false, motivo: 'no-disponible', estado: r.status };
}
