import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { crearSesionTalks, exigirTalksConfigurado, type TalksSesion } from '../../server/talks/client';
import { esEventoGuardado } from '../lib/talksSesion';
import { provisionObservationSession, type ProvisionedObservationSession } from '../serverUtils/provisionObservationSession';
import { aZiteError, guardarTalks, leerTalksGuardado, urlDeObservacion } from '../serverUtils/talksSession';

// La llave de transmisión de Mux NO sale en esta respuesta: solo viaja a Talks en el POST (ver server/talks/client.ts).
// Quien la necesite para mostrarla ya la tiene en getObservationSessionDetail (la Sala de observación).
const outputSchema = z.object({
  talksSessionId: z.string(),
  linkEquipo: z.string(),
  linkParticipantes: z.string(),
  /** Link de observación del cliente (`/s/<slug>`): la fila de la lista del calendario lo muestra junto a los dos de Talks. */
  observationUrl: z.string(),
  /** Talks ya tenía la sesión de este evento (no se creó otra). */
  yaExistia: z.boolean(),
  /** «sin-llave»: Talks no tiene la llave de Mux de la sesión, así que EN VIVO no podría transmitir. */
  transmision: z.enum(['lista', 'sin-llave']).optional(),
});
type Salida = z.infer<typeof outputSchema>;

// Dos llamadas a la vez para el mismo evento (doble clic, dos personas) comparten el mismo trabajo: así no se
// alcanza a crear dos transmisiones de Mux. Talks ya es idempotente por `externoId`.
const enCurso = new Map<string, Promise<Salida>>();

async function crear(calendarEventId: string): Promise<Salida> {
  // 1. Sin Talks conectado no se crea nada (ni siquiera la transmisión de Mux).
  try { exigirTalksConfigurado(); } catch (err) { aZiteError(err); }

  const evento = (await pool.query(`select event_name from calendar_events where id = $1`, [calendarEventId])).rows[0];
  if (!evento) throw new ZiteError({ code: 'NOT_FOUND', message: 'Este evento ya no existe o todavía no se ha guardado.' });

  // 2. La base tiene que estar lista (columnas nuevas) antes de crear nada fuera.
  await leerTalksGuardado(calendarEventId);

  // 3. La transmisión de Mux: la crea o, si el evento ya tiene sala, devuelve la misma. Sin reunión de Zoom: Talks reemplaza a Zoom
  //    como fuente del video (Sergio, 2026-11-14), así que esta sala no pide Zoom aunque esté configurado.
  let sala: ProvisionedObservationSession;
  try {
    sala = await provisionObservationSession(calendarEventId, { conZoom: false });
  } catch (err) {
    console.error('[createTalksSession] no se pudo crear la transmisión de Mux:', err);
    throw new ZiteError({
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear la transmisión de Mux para este evento. Intenta de nuevo; si sigue igual, avisa a quien administra el Hub.',
    });
  }
  if (!sala.muxStreamKey) {
    throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La sala de este evento no tiene llave de transmisión de Mux, así que Talks no podría transmitir.' });
  }

  // 4. La sesión en Talks. Con el mismo evento devuelve la misma (y actualiza nombre o llave si cambiaron).
  const nombre = ((evento.event_name as string | null)?.trim() || 'Sesión de observación').slice(0, 120);
  const observacionUrl = urlDeObservacion(sala.slug);
  let sesion: TalksSesion;
  try {
    sesion = await crearSesionTalks({
      nombre,
      externoId: calendarEventId,
      muxStreamKey: sala.muxStreamKey,
      // Talks solo acepta https; en desarrollo (http://localhost) se omite, es solo informativa.
      observacionUrl: observacionUrl.startsWith('https://') ? observacionUrl : undefined,
    });
  } catch (err) {
    aZiteError(err);
  }

  // 5. Guardar junto a la sala. Si algo falla aquí, apretar otra vez recupera la misma sesión de Talks.
  await guardarTalks(sala.id, sesion);

  return {
    talksSessionId: sesion.id,
    linkEquipo: sesion.linkEquipo,
    linkParticipantes: sesion.linkParticipantes,
    observationUrl: observacionUrl,
    yaExistia: sesion.yaExistia,
    transmision: sesion.transmision,
  };
}

export default createEndpoint({
  authenticated: true,
  description: 'Crea (o recupera) la sesión de Talks de un evento del calendario y guarda sus links junto a la Sala de observación',
  // Misma regla que la pantalla (esEventoGuardado): el id de la base, sin exigir la versión estándar de uuid que pide zod.
  inputSchema: z.object({ calendarEventId: z.string().refine((id) => esEventoGuardado(id), 'Este evento todavía no está guardado.') }),
  outputSchema,
  execute: async ({ input }) => {
    const previa = enCurso.get(input.calendarEventId);
    if (previa) return previa;
    const trabajo = crear(input.calendarEventId).finally(() => enCurso.delete(input.calendarEventId));
    enCurso.set(input.calendarEventId, trabajo);
    return trabajo;
  },
});
