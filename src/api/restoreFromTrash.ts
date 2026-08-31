import { z } from 'zod';
import { createEndpoint, RecruitmentRows, BoardColumns, CellValues, Tasks } from '../../server/compat';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function restoreBatch(ids: string[], updater: (id: string) => Promise<unknown>) {
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(updater));
    if (i + 10 < ids.length) await sleep(250);
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Restore a board, an individual row, or an individual task from trash',
  inputSchema: z.object({
    type: z.enum(['board', 'row', 'task']),
    boardId: z.string().optional(),
    boardName: z.string().optional(),
    projectCode: z.string().optional(),
    rowId: z.string().optional(),
    taskId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    if (input.type === 'board') {
      if (!input.boardId || !input.boardName || !input.projectCode) return { success: false };

      // Restore columns
      const { records: cols } = await BoardColumns.findAll({
        filters: { boardId: input.boardId },
        fields: ['id'],
        limit: 500,
      });
      await restoreBatch(cols.map(c => c.id), id => BoardColumns.update({ id, record: { deletedAt: '' } }));

      await sleep(250);

      // Restore rows
      const { records: rows } = await RecruitmentRows.findAll({
        filters: { boardName: input.boardName, projectCode: input.projectCode },
        fields: ['id'],
        limit: 2000,
      });
      await restoreBatch(rows.map(r => r.id), id => RecruitmentRows.update({ id, record: { deletedAt: '' } }));

      await sleep(250);

      // Restore tasks (grupos de Actividades/PM cascadean su borrado a Tasks
      // desde deleteBoardColumn.ts — se restauran igual que las filas)
      const { records: tasks } = await Tasks.findAll({
        filters: { boardId: input.boardId },
        fields: ['id'],
        limit: 2000,
      });
      await restoreBatch(tasks.map(t => t.id), id => Tasks.update({ id, record: { deletedAt: '' } }));

      await sleep(250);

      // Restore cells
      const { records: cells } = await CellValues.findAll({
        filters: { boardId: input.boardId },
        fields: ['id'],
        limit: 2000,
      });
      await restoreBatch(cells.map(c => c.id), id => CellValues.update({ id, record: { deletedAt: '' } }));

    } else if (input.type === 'task') {
      if (!input.taskId) return { success: false };

      // Find the task and its subtasks
      const { records: children } = await Tasks.findAll({
        filters: { parentTaskId: input.taskId },
        fields: ['id'],
        limit: 100,
      });
      const allIds = [input.taskId, ...children.map(c => c.id)];
      await restoreBatch(allIds, id => Tasks.update({ id, record: { deletedAt: '' } }));

    } else {
      if (!input.rowId) return { success: false };

      // Find the row and its children
      const { records: children } = await RecruitmentRows.findAll({
        filters: { parentRowId: input.rowId },
        fields: ['id'],
        limit: 100,
      });
      const allIds = [input.rowId, ...children.map(c => c.id)];
      await restoreBatch(allIds, id => RecruitmentRows.update({ id, record: { deletedAt: '' } }));
    }

    return { success: true };
  },
});
