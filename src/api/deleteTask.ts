import { z } from 'zod';
import { createEndpoint, Tasks, CellValues } from '../../server/compat';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a task',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    // Fetch before delete to get projectCode for Ably notification
    const task = await Tasks.findOne({ id: input.id }).catch(() => null);

    // Tasks no tiene deletedAt (es borrado duro, sin papelera) pero sus
    // Cell Values sí — incluida la celda de membresía de grupo en el board
    // `{boardId}::groups`, que referencia esta misma rowId. Sin este
    // limpiado, esa celda queda huérfana para siempre (columnId válido,
    // rowId de una tarea que ya no existe) — confirmado en vivo: el grupo
    // D2D de BIBLIOTECA acumuló 27 de 35 miembros así, y duplicateGroup.ts
    // los salta uno por uno en silencio, produciendo muchas menos filas
    // duplicadas de las que el conteo del grupo sugiere.
    const { records: cells } = await CellValues.findAll({ filters: { rowId: input.id }, limit: 500 });
    const now = new Date().toISOString();
    await Promise.all(cells.filter(c => !c.deletedAt).map(c => CellValues.update({ id: c.id, record: { deletedAt: now } })));

    await Tasks.delete({ id: input.id });

    // Publish realtime delete event (fire-and-forget — must not fail the delete)
    if (task?.projectCode) {
      try {
        await publishEvent(`board:${task.projectCode}`, 'task.deleted', {
          id: input.id,
          projectCode: task.projectCode,
          senderEmail: context.user!.email,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] task.deleted publish failed:', err);
      }
    }

    return { success: true };
  },
});
