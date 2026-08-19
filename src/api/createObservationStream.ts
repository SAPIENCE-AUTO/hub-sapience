import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { createLiveStream } from '../../server/mux/client';
import { randomBytes } from 'node:crypto';

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

const outputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  muxStreamKey: z.string(),
  muxServerUrl: z.string(),
  muxPlaybackId: z.string(),
  estado: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Crea (o recupera) el live stream de Mux para la Sala de observación de una sesión de calendario',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema,
  execute: async ({ input }) => {
    const eventResult = await pool.query(
      `select id, event_name, project_code from calendar_events where id = $1`,
      [input.calendarEventId],
    );
    const event = eventResult.rows[0];
    if (!event) throw new Error('El evento de calendario no existe.');

    // Un live stream por sesión, nunca compartido — si ya existe, se
    // devuelven las mismas credenciales en vez de crear un segundo stream
    // (protege contra doble-click en "Crear stream").
    const existing = await pool.query(
      `select id, slug, mux_stream_key, mux_playback_id, estado from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return {
        id: row.id,
        slug: row.slug,
        muxStreamKey: row.mux_stream_key,
        muxServerUrl: 'rtmps://global-live.mux.com:443/app',
        muxPlaybackId: row.mux_playback_id,
        estado: row.estado,
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

    const inserted = await pool.query(
      `insert into observation_sessions
         (calendar_event_id, slug, nombre, cliente, mux_live_stream_id, mux_stream_key, mux_playback_id, estado)
       values ($1, $2, $3, $4, $5, $6, $7, 'esperando')
       returning id, slug, mux_stream_key, mux_playback_id, estado`,
      [input.calendarEventId, slug, event.event_name, cliente, stream.id, stream.stream_key, playbackId],
    );
    const row = inserted.rows[0];
    return {
      id: row.id,
      slug: row.slug,
      muxStreamKey: row.mux_stream_key,
      muxServerUrl: 'rtmps://global-live.mux.com:443/app',
      muxPlaybackId: row.mux_playback_id,
      estado: row.estado,
    };
  },
});
