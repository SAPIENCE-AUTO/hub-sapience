import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

const capituloActivoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  totalIdeas: z.number(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Estado público de una sesión de Swipe: sesión + capítulo activo (si hay uno abierto)',
  inputSchema: z.object({ codigo: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    estadoSesion: z.string().optional(),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    capituloActivo: capituloActivoSchema.nullable().optional(),
  }),
  execute: async ({ input }) => {
    const sesionResult = await pool.query(
      `select id, nombre, cliente, estado, capitulo_activo_id from swipe_sesiones where codigo = $1`,
      [input.codigo],
    );
    const sesion = sesionResult.rows[0];
    if (!sesion) return { found: false };

    let capituloActivo = null;
    if (sesion.capitulo_activo_id) {
      const capResult = await pool.query(
        `select c.id, c.nombre, c.descripcion, count(i.id) as total_ideas
         from swipe_capitulos c
         left join swipe_ideas i on i.capitulo_id = c.id
         where c.id = $1 and c.estado = 'abierto'
         group by c.id`,
        [sesion.capitulo_activo_id],
      );
      const cap = capResult.rows[0];
      if (cap) {
        capituloActivo = {
          id: cap.id as string,
          nombre: cap.nombre as string,
          descripcion: (cap.descripcion ?? undefined) as string | undefined,
          totalIdeas: Number(cap.total_ideas ?? 0),
        };
      }
    }

    return {
      found: true,
      estadoSesion: sesion.estado as string,
      nombre: sesion.nombre as string,
      cliente: (sesion.cliente ?? undefined) as string | undefined,
      capituloActivo,
    };
  },
});
