import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * `mux_stream_key` es la ÚNICA credencial que permite transmitir a esta
 * sesión — este endpoint es público (sin login, el link circula por correo
 * a un cliente) y NUNCA debe devolverla. A propósito, este `execute` pickea
 * los campos públicos uno por uno en vez de hacer spread de la fila de
 * `observation_sessions` — así que agregar un campo nuevo aquí en el futuro
 * no puede arrastrar la fila completa sin querer. La aserción de abajo es el
 * cinturón sobre los tirantes del `outputSchema`: revienta en vez de filtrar
 * si algún día alguien reintroduce el spread.
 */
const outputSchema = z.object({
  found: z.boolean(),
  slug: z.string().optional(),
  nombre: z.string().optional(),
  cliente: z.string().optional(),
  estado: z.string().optional(),
  muxPlaybackId: z.string().optional(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Datos públicos de una Sala de observación por slug (registro, estado, playback) — nunca credenciales de stream',
  inputSchema: z.object({ slug: z.string() }),
  outputSchema,
  execute: async ({ input }) => {
    const result = await pool.query(
      `select slug, nombre, cliente, estado, mux_playback_id from observation_sessions where slug = $1`,
      [input.slug],
    );
    const row = result.rows[0];
    // Slug inexistente o sesión aún en 'borrador': mismo resultado, la página
    // pública no distingue el motivo (ver CLAUDE (1).md, "Registro").
    if (!row || row.estado === 'borrador') return { found: false };

    const publicResult = {
      found: true,
      slug: row.slug as string,
      nombre: (row.nombre ?? undefined) as string | undefined,
      cliente: (row.cliente ?? undefined) as string | undefined,
      estado: row.estado as string,
      muxPlaybackId: (row.mux_playback_id ?? undefined) as string | undefined,
    };

    if ('muxStreamKey' in publicResult || 'mux_stream_key' in publicResult) {
      throw new Error('getObservationRoomPublic estuvo a punto de devolver mux_stream_key — bloqueado.');
    }
    return publicResult;
  },
});
