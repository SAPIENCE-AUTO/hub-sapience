import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Boards, BoardColumns, CellValues } from '../../server/compat';

// Conteo real de participantes por grupo, para el widget de Reclutamiento del
// hub del proyecto. Un proyecto puede tener varios tableros de reclutamiento
// (cada uno con sus propios grupos), así que se agrupa por tablero.
//
// "Grupo" en este sistema no es un campo de la fila — son columnas reales en
// un tablero compañero `{boardId}::groups` (ver getRecruitmentGroups.ts), y
// la pertenencia de cada participante a un grupo vive en Cell Values: una
// celda con textValue:'1' en la columna de ESE grupo. Es la única forma
// correcta de saber cuánta gente hay por grupo — confirmado en vivo que el
// campo `group` de la fila viene vacío.
//
// Se acota a los tableros de ESTE proyecto (no todo el sistema) — el mismo
// principio que ya se siguió para el mini-Gantt de Timelines: tocar Cell
// Values está bien cuando el alcance es un proyecto, no cuando es global.
// El descarte de borrados se hace en JS (`!x.deletedAt`), nunca vía filtro
// SQL — ver el comentario de la versión anterior de este archivo: filtrar
// deletedAt en SQL no encontraba las filas reales (desajuste NULL vs '').
async function fetchAllRows(boardId: string): Promise<{ id: string; deletedAt?: string }[]> {
  const all: { id: string; deletedAt?: string }[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const batch = await RecruitmentRows.findAll({ filters: { boardId }, limit: 2000, offset, fields: ['deletedAt'] });
    all.push(...batch.records);
    hasMore = batch.hasMore;
    offset += batch.records.length;
  }
  return all;
}

export default createEndpoint({
  authenticated: true,
  description: 'Real participant-per-group counts per recruitment board, for the project hub landing widget',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({
    totalParticipants: z.number(),
    boards: z.array(z.object({
      boardName: z.string(),
      totalParticipants: z.number(),
      groups: z.array(z.object({ name: z.string(), count: z.number() })),
    })),
  }),
  execute: async ({ input }) => {
    const { records: recBoards } = await Boards.findAll({
      filters: { projectCode: input.projectCode, boardType: 'recruitment' } as any,
      limit: 200,
      fields: ['boardName', 'boardType', 'deletedAt'],
    });
    const activeBoards = recBoards.filter(b => !b.deletedAt && b.boardName);

    const boards: { boardName: string; totalParticipants: number; groups: { name: string; count: number }[] }[] = [];
    let totalParticipants = 0;

    for (const board of activeBoards) {
      const groupBoardId = `${board.id}::groups`;

      const [{ records: groupCols }, rows, { records: memberCells }] = await Promise.all([
        BoardColumns.findAll({ filters: { boardId: groupBoardId }, limit: 200, fields: ['columnName', 'deletedAt'] }),
        fetchAllRows(board.id),
        CellValues.findAll({ filters: { boardId: groupBoardId, textValue: '1' }, limit: 10_000, fields: ['rowId', 'columnId', 'deletedAt'] }),
      ]);

      const activeGroupCols = groupCols.filter(c => !c.deletedAt && c.columnName);
      const activeRowIds = new Set(rows.filter(r => !r.deletedAt).map(r => r.id));
      const colNameById = new Map(activeGroupCols.map(c => [c.id, c.columnName as string]));

      const tally = new Map<string, number>();
      for (const cell of memberCells) {
        if (cell.deletedAt) continue;
        if (!cell.rowId || !activeRowIds.has(cell.rowId)) continue;
        const name = colNameById.get(cell.columnId ?? '');
        if (!name) continue;
        tally.set(name, (tally.get(name) ?? 0) + 1);
      }

      const groups = activeGroupCols.map(c => ({ name: c.columnName as string, count: tally.get(c.columnName as string) ?? 0 }));

      boards.push({ boardName: board.boardName as string, totalParticipants: activeRowIds.size, groups });
      totalParticipants += activeRowIds.size;
    }

    return { totalParticipants, boards };
  },
});
