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

    // Se quita también de cualquier grupo (incluida la celda de membresía en
    // el board `{boardId}::groups`) para que una tarea borrada no siga
    // apareciendo en el conteo/miembros de un grupo mientras está en la
    // papelera.
    const { records: cells } = await CellValues.findAll({ filters: { rowId: input.id }, limit: 500 });
    const now = new Date().toISOString();
    await Promise.all(cells.filter(c => !c.deletedAt).map(c => CellValues.update({ id: c.id, record: { deletedAt: now } })));

    const u = context.user;
    const deletedBy = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
    await Tasks.update({ id: input.id, record: { deletedAt: now, deletedBy } });

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
