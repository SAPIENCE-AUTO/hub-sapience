import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Conectado ahorita = existe un heartbeat suyo en los últimos 90s (ver
// CLAUDE (1).md, sección Presencia).
const ONLINE_WINDOW_MS = 90_000;

export default createEndpoint({
  authenticated: true,
  description: 'Detalle de la Sala de observación de una sesión de calendario: credenciales, conectados y chat',
  inputSchema: z.object({ calendarEventId: z.string() }),
  outputSchema: z.object({
    session: z.object({
      id: z.string(),
      slug: z.string(),
      nombre: z.string().optional(),
      cliente: z.string().optional(),
      estado: z.string(),
      muxStreamKey: z.string().optional(),
      muxServerUrl: z.string(),
      muxPlaybackId: z.string().optional(),
      muxAssetId: z.string().optional(),
      observationUrl: z.string(),
      zoomJoinUrl: z.string().optional(),
      zoomStartUrl: z.string().optional(),
    }).optional(),
    connected: z.array(z.object({
      observerId: z.string(),
      nombre: z.string().optional(),
      apellido: z.string().optional(),
      email: z.string().optional(),
      firstSeenAt: z.string(),
      isOnline: z.boolean(),
    })),
    chat: z.array(z.object({
      id: z.string(),
      nombre: z.string().optional(),
      esProductor: z.boolean(),
      esPregunta: z.boolean(),
      body: z.string(),
      createdAt: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    const sessionResult = await pool.query(
      `select id, slug, nombre, cliente, estado, mux_stream_key, mux_playback_id, mux_asset_id, zoom_join_url, zoom_start_url
       from observation_sessions where calendar_event_id = $1`,
      [input.calendarEventId],
    );
    const s = sessionResult.rows[0];
    if (!s) return { session: undefined, connected: [], chat: [] };

    const appUrl = (process.env.ZITE_APP_URL ?? '').split(',')[0]?.trim() || 'http://localhost:5173';

    const [observersResult, chatResult] = await Promise.all([
      pool.query(
        `select o.id, o.nombre, o.apellido, o.email, o.created_at,
                (select max(ts) from observer_heartbeats h where h.observer_id = o.id) as last_heartbeat_at
         from observers o where o.session_id = $1 order by o.created_at asc`,
        [s.id],
      ),
      pool.query(
        `select id, observer_id, nombre_cache, es_productor, es_pregunta, body, created_at from (
           select c.id, c.body, c.es_productor, c.es_pregunta, c.created_at,
                  case when c.es_productor then 'Productor' else o.nombre end as nombre_cache,
                  c.observer_id
           from observation_chat c
           left join observers o on o.id = c.observer_id
           where c.session_id = $1 and c.borrado = false
           order by c.created_at desc
           limit 100
         ) t order by created_at asc`,
        [s.id],
      ),
    ]);

    const now = Date.now();
    const connected = observersResult.rows.map((o) => ({
      observerId: o.id,
      nombre: o.nombre ?? undefined,
      apellido: o.apellido ?? undefined,
      email: o.email ?? undefined,
      firstSeenAt: o.created_at,
      isOnline: o.last_heartbeat_at ? now - new Date(o.last_heartbeat_at).getTime() < ONLINE_WINDOW_MS : false,
    }));

    const chat = chatResult.rows.map((c) => ({
      id: c.id,
      nombre: c.nombre_cache ?? undefined,
      esProductor: c.es_productor,
      esPregunta: c.es_pregunta,
      body: c.body,
      createdAt: c.created_at,
    }));

    return {
      session: {
        id: s.id,
        slug: s.slug,
        nombre: s.nombre ?? undefined,
        cliente: s.cliente ?? undefined,
        estado: s.estado,
        muxStreamKey: s.mux_stream_key ?? undefined,
        muxServerUrl: 'rtmps://global-live.mux.com:443/app',
        muxPlaybackId: s.mux_playback_id ?? undefined,
        muxAssetId: s.mux_asset_id ?? undefined,
        observationUrl: `${appUrl}/s/${s.slug}`,
        zoomJoinUrl: s.zoom_join_url ?? undefined,
        zoomStartUrl: s.zoom_start_url ?? undefined,
      },
      connected,
      chat,
    };
  },
});
