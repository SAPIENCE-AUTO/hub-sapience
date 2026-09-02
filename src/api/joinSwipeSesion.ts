import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

/**
 * Público — endpoint de entrada del participante. Idempotente por
 * `(sesion_id, device_token)`: reentrar con el mismo device_token (el mismo
 * celular) actualiza el alias en vez de duplicar el registro, así que
 * recargar la página o volver a escanear el QR nunca crea un participante
 * fantasma.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Un participante entra a una sesión de Swipe con su alias y device token',
  inputSchema: z.object({
    codigo: z.string(),
    alias: z.string().min(1),
    deviceToken: z.string(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    sesionId: z.string().optional(),
    participanteId: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    estadoSesion: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, nombre, cliente, estado from swipe_sesiones where codigo = $1`,
      [input.codigo],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    const participanteResult = await pool.query(
      `insert into swipe_participantes (sesion_id, alias, device_token)
       values ($1, $2, $3)
       on conflict (sesion_id, device_token) do update set alias = excluded.alias, last_seen_at = now()
       returning id`,
      [sesion.id, input.alias, input.deviceToken],
    );

    return {
      found: true,
      sesionId: sesion.id as string,
      participanteId: participanteResult.rows[0].id as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      estadoSesion: sesion.estado as string,
    };
  },
});
