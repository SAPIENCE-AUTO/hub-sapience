import { z } from 'zod';
import { createEndpoint, BoardColumns, CellValues, Tasks, RecruitmentRows } from '../../server/compat';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createEndpoint({
  authenticated: true,
  description: 'Soft-delete a board column (a "group", when columnType is a group color) and its associated cell values. When tableType is given, also sends the group\'s member rows/tasks to the trash instead of just unassigning them — see incidente BIBLIOTECA.',
  inputSchema: z.object({ id: z.string(), tableType: z.enum(['recruitment', 'task']).optional() }),
  outputSchema: z.object({ success: z.boolean(), deletedItems: z.number() }),
  execute: async ({ input, context }) => {
    const now = new Date().toISOString();
    const u = context.user;
    const deletedBy = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

    // Cuando se sabe si esta columna es un grupo de tareas o de participantes,
    // sus miembros (filas cuya celda de membresía está en '1' para esta
    // columna) se mandan a la papelera junto con el grupo, en vez de quedar
    // huérfanos en "Sin grupo" sin ningún registro de qué pasó. Antes de esto,
    // Tasks no tenía papelera — un grupo real (p.ej. "WOMEN - GEN X" con 16
    // tareas) se podía borrar por accidente sin ninguna forma de recuperarlo.
    let deletedItems = 0;
    if (input.tableType) {
      const { records: groupCells } = await CellValues.findAll({
        filters: { columnId: input.id, textValue: '1' },
        limit: 500,
      });
      const rowIds = groupCells.map(c => c.rowId).filter((id): id is string => !!id && UUID_RE.test(id));

      if (input.tableType === 'task') {
        const results = await Promise.all(rowIds.map(async id => {
          const t = await Tasks.findOne({ id, fields: ['deletedAt'] });
          if (!t || t.deletedAt) return false;
          await Tasks.update({ id, record: { deletedAt: now, deletedBy } });
          return true;
        }));
        deletedItems = results.filter(Boolean).length;
      } else {
        const results = await Promise.all(rowIds.map(async id => {
          const r = await RecruitmentRows.findOne({ id, fields: ['deletedAt'] });
          if (!r || r.deletedAt) return false;
          await RecruitmentRows.update({ id, record: { deletedAt: now } });
          return true;
        }));
        deletedItems = results.filter(Boolean).length;
      }
    }

    // Soft-delete all associated cell values
    const { records } = await CellValues.findAll({
      filters: { columnId: input.id },
      fields: ['id'],
      limit: 500,
    });
    for (const cell of records) {
      await CellValues.update({ id: cell.id, record: { deletedAt: now } });
    }

    // Soft-delete the column itself, recording who did it
    await BoardColumns.update({
      id: input.id,
      record: { deletedAt: now, deletedBy },
    });

    return { success: true, deletedItems };
  },
});
