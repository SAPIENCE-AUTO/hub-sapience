import { z } from 'zod';
import { createEndpoint, BoardColumns, CellValues, RecruitmentRows, Tasks } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Duplicate a group column and all rows inside it',
  inputSchema: z.object({
    groupColumnId: z.string(),
    tableType: z.enum(['recruitment', 'task']),
  }),
  outputSchema: z.object({
    newGroupId: z.string(),
    duplicatedRows: z.number(),
  }),
  execute: async ({ input }) => {
    const { groupColumnId, tableType } = input;

    // 1. Find the original group column
    const origCol = await BoardColumns.findOne({ id: groupColumnId });
    if (!origCol) throw new Error('Grupo no encontrado');

    // 2. Create a new group column (same board, same color, name + " (copia)")
    const newCol = await BoardColumns.create({
      record: {
        boardId: origCol.boardId,
        columnName: `${origCol.columnName ?? 'Grupo'} (copia)`,
        columnType: origCol.columnType, // color id
        columnOrder: (origCol.columnOrder ?? 0) + 0.5,
      },
    });

    // 3. Find all rows belonging to the original group
    const { records: groupCells } = await CellValues.findAll({
      filters: { columnId: groupColumnId, textValue: '1' },
      limit: 500,
    });
    // Descarta rowIds que no son UUID reales — una celda de membresía puede
    // quedar apuntando a un id temporal de cliente (`temp-<timestamp>`) si
    // la fila se asignó a un grupo antes de que el create() del row
    // resolviera (bug de UI ya corregido, pero la basura que ya quedó
    // escrita en producción no se limpia sola). Sin este filtro, un solo
    // rowId así tronaba TODO el loop con "invalid input syntax for type
    // uuid" y ninguna fila se duplicaba, ni siquiera las anteriores en la
    // lista — confirmado en vivo contra el grupo D2D de BIBLIOTECA.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rowIds = groupCells.map(c => c.rowId).filter((id): id is string => !!id && UUID_RE.test(id));

    // 4. Duplicate each row and assign to new group
    let duplicatedRows = 0;
    for (const rowId of rowIds) {
      if (tableType === 'recruitment') {
        const orig = await RecruitmentRows.findOne({ id: rowId });
        if (!orig || orig.deletedAt) continue;
        const { id: _id, ...rest } = orig;
        const newRow = await RecruitmentRows.create({
          record: {
            ...rest,
            rowName: `${rest.rowName ?? 'Fila'} (copia)`,
            participantName: rest.participantName ? `${rest.participantName} (copia)` : rest.participantName,
          },
        });

        // Copy cell values excluding the old group assignment
        const { records: cells } = await CellValues.findAll({ filters: { rowId }, limit: 500 });
        const cellsToClone = cells.filter(c => c.columnId !== groupColumnId);
        for (let i = 0; i < cellsToClone.length; i += 50) {
          await CellValues.bulkCreate({
            records: cellsToClone.slice(i, i + 50).map(c => ({
              boardId: c.boardId,
              rowId: newRow.id,
              columnId: c.columnId,
              textValue: c.textValue,
              numberValue: c.numberValue,
              dateValue: c.dateValue,
              booleanValue: c.booleanValue,
              fileUrl: c.fileUrl,
            })),
          });
        }

        // Assign to the new group
        await CellValues.create({
          record: {
            boardId: origCol.boardId ?? '',
            rowId: newRow.id,
            columnId: newCol.id,
            textValue: '1',
          },
        });

        duplicatedRows++;
      } else {
        const orig = await Tasks.findOne({ id: rowId });
        if (!orig) continue;
        const { id: _id, ...rest } = orig;
        const newTask = await Tasks.create({
          record: { ...rest, taskName: `${rest.taskName ?? 'Tarea'} (copia)` },
        });

        // Copy cell values excluding the old group assignment
        const { records: cells } = await CellValues.findAll({ filters: { rowId }, limit: 500 });
        const cellsToClone = cells.filter(c => c.columnId !== groupColumnId);
        for (let i = 0; i < cellsToClone.length; i += 50) {
          await CellValues.bulkCreate({
            records: cellsToClone.slice(i, i + 50).map(c => ({
              boardId: c.boardId,
              rowId: newTask.id,
              columnId: c.columnId,
              textValue: c.textValue,
              numberValue: c.numberValue,
              dateValue: c.dateValue,
              booleanValue: c.booleanValue,
              fileUrl: c.fileUrl,
            })),
          });
        }

        // Assign to the new group
        await CellValues.create({
          record: {
            boardId: origCol.boardId ?? '',
            rowId: newTask.id,
            columnId: newCol.id,
            textValue: '1',
          },
        });

        duplicatedRows++;
      }
    }

    return { newGroupId: newCol.id, duplicatedRows };
  },
});
