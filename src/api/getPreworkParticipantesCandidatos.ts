import { z } from 'zod';
import { createEndpoint, ZiteError, Projects, Boards, BoardColumns, RecruitmentRows, CellValues, pool } from '../../server/compat';

const candidatoSchema = z.object({
  recruitmentRowId: z.string(),
  participanteId: z.string().optional(),
  nombre: z.string(),
  email: z.string(),
  boardName: z.string(),
  grupo: z.string(),
  grupoColorId: z.string().optional(),
  yaAsignado: z.boolean(),
  incluido: z.boolean(),
  estadoParticipacion: z.string().optional(),
});

/**
 * Candidatos a Prework = filas de Reclutamiento con grupo asignado, en
 * cualquiera de los tableros de reclutamiento del proyecto. Sigue el mismo
 * patrón dual-read (UUID + boardId legado "recruitment-{code}-{board}") que
 * getRecruitmentSummary.ts — "grupo" no es un campo de la fila, es una
 * columna real en el tablero compañero `{boardId}::groups` con una celda
 * textValue:'1' por membresía (ver ese archivo para el porqué).
 *
 * Filas sin email quedan fuera: sin correo no hay forma de invitarlas al
 * portal de Prework.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Lista participantes de reclutamiento con grupo asignado, marcando cuáles ya están en este estudio de Prework',
  inputSchema: z.object({ estudioId: z.string() }),
  outputSchema: z.object({ candidatos: z.array(candidatoSchema) }),
  execute: async ({ input }) => {
    const { rows: estudioRows } = await pool.query<{ proyecto_id: string }>(
      `select proyecto_id from prework_estudios where id = $1`,
      [input.estudioId],
    );
    if (!estudioRows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Estudio no encontrado' });
    const proyectoId = estudioRows[0].proyecto_id;

    const proyecto = await Projects.findOne({ id: proyectoId, fields: ['projectCode'] });
    if (!proyecto) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
    const projectCode = proyecto.projectCode as string;

    const { records: recBoards } = await Boards.findAll({
      filters: { projectCode, boardType: 'recruitment' } as any,
      limit: 200,
      fields: ['boardName', 'boardType', 'deletedAt'],
    });
    const activeBoards = recBoards.filter(b => !b.deletedAt && b.boardName);

    const candidatos: z.infer<typeof candidatoSchema>[] = [];

    for (const board of activeBoards) {
      const boardName = board.boardName as string;
      const groupBoardIdCandidates = [`${board.id}::groups`, `recruitment-${projectCode}-${boardName}::groups`];

      const [colResults, rowsResult, cellResults] = await Promise.all([
        Promise.all(groupBoardIdCandidates.map(bid =>
          BoardColumns.findAll({ filters: { boardId: bid }, limit: 200, fields: ['columnName', 'columnType', 'deletedAt'] })
        )),
        RecruitmentRows.findAll({ filters: { boardId: board.id }, limit: 2000, fields: ['participantName', 'email', 'deletedAt'] }),
        Promise.all(groupBoardIdCandidates.map(bid =>
          CellValues.findAll({ filters: { boardId: bid, textValue: '1' }, limit: 10_000, fields: ['rowId', 'columnId', 'deletedAt'] })
        )),
      ]);

      const colNameById = new Map<string, string>();
      const colColorById = new Map<string, string | undefined>();
      for (const { records } of colResults) {
        for (const c of records) {
          if (c.deletedAt || !c.columnName) continue;
          colNameById.set(c.id, c.columnName as string);
          colColorById.set(c.id, (c.columnType as string) || undefined);
        }
      }

      const groupByRowId = new Map<string, { nombre: string; colorId?: string }>();
      for (const { records } of cellResults) {
        for (const cell of records) {
          if (cell.deletedAt || !cell.rowId || !cell.columnId) continue;
          const groupName = colNameById.get(cell.columnId);
          if (groupName) groupByRowId.set(cell.rowId, { nombre: groupName, colorId: colColorById.get(cell.columnId) });
        }
      }

      for (const row of rowsResult.records) {
        if (row.deletedAt || !row.email) continue;
        const grupo = groupByRowId.get(row.id);
        if (!grupo) continue; // solo candidatos con grupo asignado
        candidatos.push({
          recruitmentRowId: row.id,
          nombre: (row.participantName as string) || row.email,
          email: row.email as string,
          boardName,
          grupo: grupo.nombre,
          grupoColorId: grupo.colorId,
          yaAsignado: false,
          incluido: true,
          estadoParticipacion: undefined,
        });
      }
    }

    if (candidatos.length === 0) return { candidatos };

    // Cruce con prework: por email (case-insensitive) — un candidato puede
    // ya tener cuenta de otro estudio, así que el join real es contra la
    // asignación a ESTE estudio, no contra la existencia del participante.
    const { rows: asignados } = await pool.query<{ id: string; email: string; incluido: boolean; estado_participacion: string }>(
      `select p.id, p.email, a.incluido, a.estado_participacion
       from prework_asignaciones a
       join prework_participantes p on p.id = a.prework_participante_id
       where a.prework_estudio_id = $1`,
      [input.estudioId],
    );
    const asignadoByEmail = new Map(asignados.map(a => [a.email.toLowerCase(), a]));

    for (const c of candidatos) {
      const asignado = asignadoByEmail.get(c.email.toLowerCase());
      if (asignado) {
        c.yaAsignado = true;
        c.participanteId = asignado.id;
        c.incluido = asignado.incluido;
        c.estadoParticipacion = asignado.estado_participacion;
      }
    }

    candidatos.sort((a, b) => a.boardName.localeCompare(b.boardName) || a.grupo.localeCompare(b.grupo) || a.nombre.localeCompare(b.nombre));

    return { candidatos };
  },
});
