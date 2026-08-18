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
      const uuidGroupBoardId = `${board.id}::groups`;
      // Las columnas de grupo (y sus celdas de membresía) de un tablero de
      // reclutamiento pueden quedar repartidas entre el boardId UUID y el
      // compuesto legado `recruitment-{projectCode}-{boardName}` — mismo
      // residuo de la migración a UUID documentado en CLAUDE.md §6
      // (smartWrite.ts / resolveBoardId.ts). getBoardColumns.ts ya hace este
      // merge-read para el tablero real (confirmado en vivo: NARANJA tiene
      // sus 6 grupos repartidos así, 4 solo bajo el id legado) — sin este
      // merge, el widget veía únicamente los grupos creados después de la
      // migración y reportaba "2 grupos" cuando el tablero real muestra 6.
      const legacyGroupBoardId = `recruitment-${input.projectCode}-${board.boardName}::groups`;
      const groupBoardIdCandidates = [uuidGroupBoardId, legacyGroupBoardId];

      const [colResults, rows, cellResults] = await Promise.all([
        Promise.all(groupBoardIdCandidates.map(bid =>
          BoardColumns.findAll({ filters: { boardId: bid }, limit: 200, fields: ['columnName', 'deletedAt'] })
        )),
        fetchAllRows(board.id),
        Promise.all(groupBoardIdCandidates.map(bid =>
          CellValues.findAll({ filters: { boardId: bid, textValue: '1' }, limit: 10_000, fields: ['rowId', 'columnId', 'deletedAt'] })
        )),
      ]);

      const seenColIds = new Set<string>();
      const activeGroupCols: { id: string; columnName: string }[] = [];
      for (const { records } of colResults) {
        for (const c of records) {
          if (c.deletedAt || !c.columnName || seenColIds.has(c.id)) continue;
          seenColIds.add(c.id);
          activeGroupCols.push({ id: c.id, columnName: c.columnName as string });
        }
      }

      const seenCellIds = new Set<string>();
      const memberCells: { id: string; rowId?: string; columnId?: string; deletedAt?: string }[] = [];
      for (const { records } of cellResults) {
        for (const cell of records) {
          if (seenCellIds.has(cell.id)) continue;
          seenCellIds.add(cell.id);
          memberCells.push(cell);
        }
      }

      const activeRowIds = new Set(rows.filter(r => !r.deletedAt).map(r => r.id));
      const colNameById = new Map(activeGroupCols.map(c => [c.id, c.columnName]));

      const tally = new Map<string, number>();
      for (const cell of memberCells) {
        if (cell.deletedAt) continue;
        if (!cell.rowId || !activeRowIds.has(cell.rowId)) continue;
        const name = colNameById.get(cell.columnId ?? '');
        if (!name) continue;
        tally.set(name, (tally.get(name) ?? 0) + 1);
      }

      const groups = activeGroupCols.map(c => ({ name: c.columnName, count: tally.get(c.columnName) ?? 0 }));

      boards.push({ boardName: board.boardName as string, totalParticipants: activeRowIds.size, groups });
      totalParticipants += activeRowIds.size;
    }

    return { totalParticipants, boards };
  },
});
