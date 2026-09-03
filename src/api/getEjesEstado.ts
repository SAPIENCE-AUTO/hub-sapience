import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const tableroActivoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  totalIdeas: z.number(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Estado público de una sesión de Ejes: sesión + tablero activo (si hay uno abierto)',
  inputSchema: z.object({ codigo: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    estadoSesion: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    tableroActivo: tableroActivoSchema.nullable().optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, nombre, cliente, estado from ejes_sesiones where codigo = $1`,
      [input.codigo],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    // A diferencia de Swipe (que guarda capitulo_activo_id en la sesión),
    // aquí basta con el primer tablero 'abierto' de la sesión — no hace
    // falta duplicar el puntero, el estado de la tabla ya es la fuente de verdad.
    const tabResult = await pool.query(
      `select t.id, t.nombre, t.descripcion, count(i.id) as total_ideas
       from ejes_tableros t
       left join ejes_ideas i on i.tablero_id = t.id
       where t.sesion_id = $1 and t.estado = 'abierto'
       group by t.id
       limit 1`,
      [sesion.id],
    );
    const tab = tabResult.rows[0];

    return {
      found: true,
      estadoSesion: sesion.estado as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      tableroActivo: tab
        ? {
            id: tab.id as string,
            nombre: tab.nombre as string,
            descripcion: (tab.descripcion ?? undefined) as string | undefined,
            totalIdeas: Number(tab.total_ideas ?? 0),
          }
        : null,
    };
  },
});
