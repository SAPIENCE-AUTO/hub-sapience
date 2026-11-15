import { pool, ZiteError } from '../../server/compat';
import { TalksError, type TalksSesion } from '../../server/talks/client';

/**
 * Lo que el Hub guarda de la sesión de Talks de un evento, junto a su sala de observación
 * (observation_sessions.talks_*; las columnas las agrega server/scripts/add-observation-talks-columns.ts).
 * Compartido por createTalksSession.ts y getTalksSession.ts.
 */
export interface TalksGuardado {
  /** id de la fila de observation_sessions (la sala del evento). */
  salaId: string;
  /** Parte final del link de observación del cliente (`/s/<slug>`). */
  slug: string;
  talksSessionId?: string;
  linkEquipo?: string;
  linkParticipantes?: string;
}

export const SIN_MIGRACION =
  'Falta preparar la base de datos para Talks (hay que correr el script add-observation-talks-columns). Avisa a quien administra el Hub.';

/**
 * El link de observación del cliente: la misma dirección que arman la Sala de observación (getObservationSessionDetail) y «Crear stream»
 * (`ZITE_APP_URL`, la primera si hay varias, y `/s/<slug>`). Una sola función para que la ventana del evento y la fila de la lista muestren el mismo link.
 */
export function urlDeObservacion(slug: string): string {
  const appUrl = (process.env.ZITE_APP_URL ?? '').split(',')[0]?.trim() || 'http://localhost:5173';
  return `${appUrl}/s/${slug}`;
}

/**
 * Lee lo guardado para el evento. Devuelve null si el evento no tiene sala de observación.
 * Sirve también de comprobación: si la base no tiene las columnas nuevas, falla aquí con un mensaje claro,
 * antes de que alguien cree nada en Mux ni en Talks.
 */
export async function leerTalksGuardado(calendarEventId: string): Promise<TalksGuardado | null> {
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await pool.query(
      `select id, slug, talks_session_id, talks_link_equipo, talks_link_participantes
       from observation_sessions where calendar_event_id = $1
       order by created_at asc limit 1`,
      [calendarEventId],
    ));
  } catch (err) {
    // 42703 = columna que no existe: el código ya subió pero la migración todavía no se corrió.
    if ((err as { code?: string }).code === '42703') throw new ZiteError({ code: 'INTERNAL_ERROR', message: SIN_MIGRACION });
    throw err;
  }
  const fila = rows[0];
  if (!fila) return null;
  return {
    salaId: String(fila.id),
    slug: String(fila.slug),
    talksSessionId: (fila.talks_session_id as string | null) ?? undefined,
    linkEquipo: (fila.talks_link_equipo as string | null) ?? undefined,
    linkParticipantes: (fila.talks_link_participantes as string | null) ?? undefined,
  };
}

/** Lo que la lista de eventos muestra de Talks en la fila de cada evento. */
export interface TalksDeEvento {
  talksSessionId: string;
  linkEquipo: string;
  linkParticipantes: string;
  /** Link de observación del cliente (`/s/<slug>`). */
  observationUrl: string;
}

let avisoTalksListaDado = false;

/**
 * Los datos de Talks de TODOS los eventos de la lista, en una sola consulta (la fila no pregunta evento por evento). Va en la misma carga de
 * getTasks que ya trae el estado de Zoom. Solo salen los eventos que ya tienen sus links; con varias salas por evento vale la primera, igual
 * que leerTalksGuardado. Si la consulta falla (por ejemplo, falta correr la migración de las columnas talks_*), devuelve vacío: la lista del
 * calendario no puede dejar de cargar por esto, y sin datos la fila ofrece «Crear links de sesión», que recupera lo que ya exista sin duplicar.
 */
export async function leerTalksDeEventos(eventIds: string[]): Promise<Map<string, TalksDeEvento>> {
  const mapa = new Map<string, TalksDeEvento>();
  if (eventIds.length === 0) return mapa;
  try {
    const { rows } = await pool.query(
      `select calendar_event_id, slug, talks_session_id, talks_link_equipo, talks_link_participantes
         from observation_sessions
        where calendar_event_id = any($1::uuid[])
        order by created_at asc`,
      [eventIds],
    );
    const vistos = new Set<string>();
    for (const r of rows as Array<Record<string, unknown>>) {
      const eventoId = String(r.calendar_event_id);
      if (vistos.has(eventoId)) continue;
      vistos.add(eventoId);
      const { talks_session_id: id, talks_link_equipo: equipo, talks_link_participantes: participantes, slug } = r;
      if (typeof id === 'string' && id && typeof equipo === 'string' && equipo && typeof participantes === 'string' && participantes && typeof slug === 'string' && slug) {
        mapa.set(eventoId, { talksSessionId: id, linkEquipo: equipo, linkParticipantes: participantes, observationUrl: urlDeObservacion(slug) });
      }
    }
  } catch (err) {
    if (!avisoTalksListaDado) {
      avisoTalksListaDado = true; // una vez por arranque: la lista se carga seguido y el aviso no debe llenar los registros
      console.error('[getTasks] no se pudieron leer los datos de Talks de los eventos; la lista sigue sin ellos:', (err as Error)?.message ?? err);
    }
    return new Map();
  }
  return mapa;
}

/** Los campos que se agregan a cada evento de getTasks (nada si el evento todavía no tiene links de Talks). */
export function camposTalksDeEvento(talks: TalksDeEvento | undefined): {
  talksSessionId?: string; talksLinkEquipo?: string; talksLinkParticipantes?: string; observationUrl?: string;
} {
  return talks
    ? { talksSessionId: talks.talksSessionId, talksLinkEquipo: talks.linkEquipo, talksLinkParticipantes: talks.linkParticipantes, observationUrl: talks.observationUrl }
    : {};
}

/** Guarda el id de la sesión de Talks y sus dos links en la sala. Repetirlo con los mismos datos no cambia nada. */
export async function guardarTalks(salaId: string, sesion: Pick<TalksSesion, 'id' | 'linkEquipo' | 'linkParticipantes'>): Promise<void> {
  await pool.query(
    `update observation_sessions
        set talks_session_id = $1, talks_link_equipo = $2, talks_link_participantes = $3
      where id = $4`,
    [sesion.id, sesion.linkEquipo, sesion.linkParticipantes, salaId],
  );
}

/**
 * Cualquier excepción que no sea ZiteError llega a la pantalla como «Error interno» sin motivo. Los errores de
 * Talks ya traen su frase en español llano: aquí pasan a ZiteError para que se vean tal cual.
 * Nunca se usa UNAUTHORIZED: un 401 hacia el navegador parecería que se venció la sesión de quien aprieta el botón,
 * y aquí lo que falló es la llave entre el Hub y Talks.
 */
export function aZiteError(err: unknown): never {
  if (err instanceof TalksError) {
    throw new ZiteError({ code: err.tipo === 'datos-invalidos' ? 'BAD_REQUEST' : 'INTERNAL_ERROR', message: err.message });
  }
  throw err;
}
