import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// pendientes_personales no vive en Zite (ver server/scripts/add-personal-pendientes-table.ts)
// así que este endpoint le habla con pool.query crudo, no con un modelo generado.
export default createEndpoint({
  authenticated: true,
  description: 'Lista los pendientes personales del usuario logueado (su parking lot)',
  inputSchema: z.object({}),
  outputSchema: z.object({
    items: z.array(z.object({
      id: z.string(),
      titulo: z.string(),
      notas: z.string().nullable(),
      area: z.string(),
      status: z.string(),
      fuente: z.string(),
      proyectoCode: z.string().nullable(),
      correoAsunto: z.string().nullable(),
      correoRemitente: z.string().nullable(),
      correoRecibidoAt: z.string().nullable(),
      fechaLimite: z.string().nullable(),
      completedAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    const { rows } = await pool.query(
      `select id, titulo, notas, area, status, fuente, proyecto_code, correo_asunto, correo_remitente,
              correo_recibido_at, fecha_limite, completed_at, created_at, updated_at
         from pendientes_personales
        where user_id = $1
        order by (status = 'Resuelto') asc, created_at desc
        limit 500`,
      [context.user!.id],
    );

    return {
      items: rows.map(r => ({
        id: r.id,
        titulo: r.titulo,
        notas: r.notas,
        area: r.area,
        status: r.status,
        fuente: r.fuente,
        proyectoCode: r.proyecto_code,
        correoAsunto: r.correo_asunto,
        correoRemitente: r.correo_remitente,
        correoRecibidoAt: r.correo_recibido_at ? new Date(r.correo_recibido_at).toISOString() : null,
        fechaLimite: r.fecha_limite ? new Date(r.fecha_limite).toISOString().slice(0, 10) : null,
        completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      })),
    };
  },
});
