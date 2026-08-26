import { z } from 'zod';
import { createEndpoint, pool, Boards } from '../../server/compat';

// pendientes_personales no vive en Zite (ver server/scripts/add-personal-pendientes-table.ts)
// así que este endpoint le habla con pool.query crudo, no con un modelo generado.
//
// El "área" se maneja con el motor de grupos real (BoardColumns/CellValues,
// mismo que usan Reclutamiento/Calendario) — eso exige un boardId que
// getBoardColumns.ts sepa resolver: o un prefijo legacy reconocido
// (recruitment-/cal-/pm-/events-) o un UUID real de una fila en Boards. Un
// string inventado (ej. `personal-pendientes-<userId>`) no calza en ninguno
// de los dos y getBoardColumns.ts lo trata como "formato desconocido" →
// siempre vacío. Por eso se crea una fila real en Boards por usuario —
// boardName como marcador único (Boards no tiene columna user_id, y
// agregarla es un cambio de esquema que le corresponde al pipeline de
// generate.py, no a un hack aquí), projectCode null porque no es de ningún
// proyecto, boardType propio para no calzar con la rama de "recruitment"
// (que hace un merge-read especial que no aplica aquí).
const PENDIENTES_BOARD_TYPE = 'personal-pendientes';

async function ensurePendientesBoard(userId: string): Promise<string> {
  const marker = `personal-pendientes-${userId}`;
  const existing = await Boards.findOne({ filters: { boardName: marker, boardType: PENDIENTES_BOARD_TYPE } });
  if (existing && !existing.deletedAt) return existing.id;
  const created = await Boards.create({ record: { boardName: marker, boardType: PENDIENTES_BOARD_TYPE } });
  return created.id;
}

export default createEndpoint({
  authenticated: true,
  description: 'Lista los pendientes personales del usuario logueado (su parking lot) y el board id real para sus grupos/áreas',
  inputSchema: z.object({}),
  outputSchema: z.object({
    groupBoardId: z.string(),
    items: z.array(z.object({
      id: z.string(),
      titulo: z.string(),
      notas: z.string().nullable(),
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
    const userId = context.user!.id;
    const [groupBoardId, { rows }] = await Promise.all([
      ensurePendientesBoard(userId),
      pool.query(
        `select id, titulo, notas, status, fuente, proyecto_code, correo_asunto, correo_remitente,
                correo_recibido_at, fecha_limite, completed_at, created_at, updated_at
           from pendientes_personales
          where user_id = $1
          order by (status = 'Resuelto') asc, created_at desc
          limit 500`,
        [userId],
      ),
    ]);

    return {
      groupBoardId,
      items: rows.map(r => ({
        id: r.id,
        titulo: r.titulo,
        notas: r.notas,
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
