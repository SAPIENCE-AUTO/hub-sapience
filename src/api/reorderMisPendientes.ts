import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// pendientes_personales no vive en Zite (ver server/scripts/add-personal-pendientes-table.ts)
// así que esto habla con pool.query crudo, igual que el resto de sus endpoints —
// mismo shape que reorderRecruitmentRows.ts/reorderTasks.ts, pero acotado al
// dueño en cada update (esas tablas son ORM y no necesitan este chequeo aparte).
export default createEndpoint({
  authenticated: true,
  description: 'Batch update de row_order para persistir el drag-and-drop de Mis Pendientes',
  inputSchema: z.object({ updates: z.array(z.object({ id: z.string(), rowOrder: z.number() })) }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;
    for (let i = 0; i < input.updates.length; i += 50) {
      const chunk = input.updates.slice(i, i + 50);
      await Promise.all(chunk.map(u =>
        pool.query(`update pendientes_personales set row_order = $1 where id = $2 and user_id = $3`, [u.rowOrder, u.id, userId]),
      ));
    }
    return { success: true };
  },
});
