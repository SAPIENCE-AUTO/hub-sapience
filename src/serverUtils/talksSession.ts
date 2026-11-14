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
  talksSessionId?: string;
  linkEquipo?: string;
  linkParticipantes?: string;
}

export const SIN_MIGRACION =
  'Falta preparar la base de datos para Talks (hay que correr el script add-observation-talks-columns). Avisa a quien administra el Hub.';

/**
 * Lee lo guardado para el evento. Devuelve null si el evento no tiene sala de observación.
 * Sirve también de comprobación: si la base no tiene las columnas nuevas, falla aquí con un mensaje claro,
 * antes de que alguien cree nada en Mux ni en Talks.
 */
export async function leerTalksGuardado(calendarEventId: string): Promise<TalksGuardado | null> {
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await pool.query(
      `select id, talks_session_id, talks_link_equipo, talks_link_participantes
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
    talksSessionId: (fila.talks_session_id as string | null) ?? undefined,
    linkEquipo: (fila.talks_link_equipo as string | null) ?? undefined,
    linkParticipantes: (fila.talks_link_participantes as string | null) ?? undefined,
  };
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
