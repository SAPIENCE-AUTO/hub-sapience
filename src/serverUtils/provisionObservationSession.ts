import { pool } from '../../server/compat';
import { createLiveStream } from '../../server/mux/client';
import { createZoomMeeting, setZoomLiveStream, ZoomAuthError } from '../../server/zoom/client';
import { randomBytes } from 'node:crypto';

const MUX_SERVER_URL = 'rtmps://global-live.mux.com:443/app';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'sesion'
  );
}

/**
 * Escoge, de la lista de correos en ZITE_ZOOM_HOST_EMAILS, uno que no tenga
 * ya otra sesión de observación con Zoom asignado cuyo horario se cruce con
 * [startTime, endTime) — mismo problema que "un live stream de Mux por
 * sesión, nunca compartido" (CLAUDE (1).md), aplicado a las cuentas de Zoom:
 * una cuenta no puede hostear dos meetings al mismo tiempo.
 *
 * Devuelve null si no hay ninguna libre en ese horario (o si no hay pool
 * configurado) — se trata igual que "Zoom no configurado": el stream de Mux
 * se crea de todos modos, sin Zoom.
 */
function zoomHostPool(): string[] {
  return (process.env.ZITE_ZOOM_HOST_EMAILS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
}

async function pickFreeZoomHost(startTime: Date, endTime: Date): Promise<string | null> {
  const pool_ = zoomHostPool();
  if (pool_.length === 0) return null;

  const { rows: busy } = await pool.query(
    `select distinct os.zoom_host_email
     from observation_sessions os
     join calendar_events ce on ce.id = os.calendar_event_id
     where os.zoom_host_email is not null
       and ce.event_date is not null
       and ce.event_date < $2
       and (ce.event_date + (coalesce(ce.duration_hours, 1) * interval '1 hour')) > $1`,
    [startTime.toISOString(), endTime.toISOString()],
  );
  const busyHosts = new Set(busy.map((r) => r.zoom_host_email as string));
  return pool_.find((h) => !busyHosts.has(h)) ?? null;
}

export interface ProvisionedObservationSession {
  id: string;
  slug: string;
  estado: string;
  muxStreamKey: string;
  muxServerUrl: string;
  muxPlaybackId: string;
  zoomJoinUrl?: string;
  zoomStartUrl?: string;
  /** Motivo por el que Zoom se omitió esta vez, si aplica — para que el botón lo diga en el toast. */
  zoomSkippedReason?: string;
}

/**
 * Crea (o recupera) el stream de Mux + el meeting de Zoom de una sesión de
 * calendario, y guarda todo en observation_sessions. Compartido entre
 * `createObservationStream.ts` (botón dentro del EventDetailDialog) y
 * `executeButtonAction.ts` (columna "Botón" del tablero de calendario) — un
 * solo lugar para no duplicar la lógica de aprovisionamiento.
 *
 * Si Zoom no está configurado, no hay cuenta libre a esa hora, o su API
 * falla, el stream de Mux se crea igual — el link de Zoom queda vacío en
 * vez de reventar el botón completo.
 */
export async function provisionObservationSession(calendarEventId: string): Promise<ProvisionedObservationSession> {
  const eventResult = await pool.query(
    `select id, event_name, project_code, event_date, duration_hours from calendar_events where id = $1`,
    [calendarEventId],
  );
  const event = eventResult.rows[0];
  if (!event) throw new Error('El evento de calendario no existe.');

  // Un live stream por sesión, nunca compartido — si ya existe, se
  // devuelven las mismas credenciales en vez de crear un segundo stream
  // (protege contra doble-click en "Crear stream").
  const existing = await pool.query(
    `select id, slug, mux_stream_key, mux_playback_id, estado, zoom_join_url, zoom_start_url
     from observation_sessions where calendar_event_id = $1`,
    [calendarEventId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      id: row.id,
      slug: row.slug,
      estado: row.estado,
      muxStreamKey: row.mux_stream_key,
      muxServerUrl: MUX_SERVER_URL,
      muxPlaybackId: row.mux_playback_id,
      zoomJoinUrl: row.zoom_join_url ?? undefined,
      zoomStartUrl: row.zoom_start_url ?? undefined,
    };
  }

  let cliente: string | null = null;
  if (event.project_code) {
    const projectResult = await pool.query(`select client from projects where project_code = $1 limit 1`, [event.project_code]);
    cliente = projectResult.rows[0]?.client ?? null;
  }

  const stream = await createLiveStream();
  const playbackId = stream.playback_ids?.[0]?.id;
  if (!playbackId) throw new Error('Mux no devolvió un playback id para el live stream.');

  const slug = `${slugify(event.event_name || 'sesion')}-${randomBytes(4).toString('hex')}`;
  // Zoom exige page_url al conectar el live stream (la URL donde se ve la
  // transmisión) — usamos nuestra propia sala de observación, ya que es
  // justo eso.
  const appUrl = (process.env.ZITE_APP_URL ?? '').split(',')[0]?.trim() || 'http://localhost:5173';
  const observationUrl = `${appUrl}/s/${slug}`;

  let zoomJoinUrl: string | undefined;
  let zoomStartUrl: string | undefined;
  let zoomMeetingId: number | undefined;
  let zoomHostEmail: string | null = null;
  let zoomSkippedReason: string | undefined;

  if (!event.event_date) {
    zoomSkippedReason = 'el evento no tiene fecha/hora todavía';
  } else {
    const startTime = new Date(event.event_date);
    const durationMinutes = event.duration_hours ? Math.round(Number(event.duration_hours) * 60) : 60;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    zoomHostEmail = await pickFreeZoomHost(startTime, endTime);
    if (!zoomHostEmail) {
      zoomSkippedReason = 'no configurado, o sin cuentas de Zoom libres a esa hora';
    } else {
      try {
        // El resto del pool queda como alternative host — así cualquiera de
        // ellos puede arrancar el meeting (con join_url, no start_url — ver
        // la nota de alternative hosts) sin depender de que la cuenta
        // asignada por disponibilidad de horario sea quien esté presente.
        const alternativeHosts = zoomHostPool().filter((h) => h !== zoomHostEmail);
        const meeting = await createZoomMeeting({
          hostEmail: zoomHostEmail,
          alternativeHosts,
          topic: event.event_name || 'Sesión de observación',
          startTimeIso: startTime.toISOString(),
          durationMinutes,
        });
        await setZoomLiveStream(meeting.id, { streamUrl: MUX_SERVER_URL, streamKey: stream.stream_key, pageUrl: observationUrl });
        zoomJoinUrl = meeting.join_url;
        zoomStartUrl = meeting.start_url;
        zoomMeetingId = meeting.id;
      } catch (err) {
        zoomHostEmail = null; // no se quedó reservado si no se pudo crear
        if (err instanceof ZoomAuthError) {
          console.warn('[provisionObservationSession] Zoom no disponible, se omite:', err.message);
          zoomSkippedReason = 'la API de Zoom falló';
        } else {
          throw err;
        }
      }
    }
  }

  const inserted = await pool.query(
    `insert into observation_sessions
       (calendar_event_id, slug, nombre, cliente, mux_live_stream_id, mux_stream_key, mux_playback_id, estado, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_host_email)
     values ($1, $2, $3, $4, $5, $6, $7, 'esperando', $8, $9, $10, $11)
     returning id, slug, mux_stream_key, mux_playback_id, estado, zoom_join_url, zoom_start_url`,
    [calendarEventId, slug, event.event_name, cliente, stream.id, stream.stream_key, playbackId, zoomMeetingId ?? null, zoomJoinUrl ?? null, zoomStartUrl ?? null, zoomHostEmail],
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    slug: row.slug,
    estado: row.estado,
    muxStreamKey: row.mux_stream_key,
    muxServerUrl: MUX_SERVER_URL,
    muxPlaybackId: row.mux_playback_id,
    zoomJoinUrl: row.zoom_join_url ?? undefined,
    zoomStartUrl: row.zoom_start_url ?? undefined,
    zoomSkippedReason,
  };
}
