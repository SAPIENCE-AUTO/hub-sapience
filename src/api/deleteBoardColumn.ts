import { z } from 'zod';
import { createEndpoint, BoardColumns, CellValues, Tasks, RecruitmentRows } from '../../server/compat';
import { pool } from '../../server/compat/db';

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

    // Confirmado en vivo (incidente BIBLIOTECA, "Fase 5"): sin transacción, una
    // interrupción a media ejecución (restart del backend, blip de red/DB —
    // ambos ya vistos en esta misma app) podía dejar las tareas del grupo
    // marcadas como borradas mientras el grupo y sus cell_values de membresía
    // seguían vivos — el usuario veía "se borró" pero un reload mostraba el
    // grupo vacío de vuelta, con sus tareas huérfanas en "Sin grupo". Todo el
    // borrado (cascada a tareas/participantes, cell_values y la columna) va
    // ahora en una sola transacción: o se aplica completo, o el usuario ve un
    // error real y nada queda a medias — mismo patrón ya usado en
    // bulkCreate/bulkInsert (server/compat/model.ts).
    const client = await pool.connect();
    try {
      await client.query('begin');

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
        }, client);
        const rowIds = groupCells.map(c => c.rowId).filter((id): id is string => !!id && UUID_RE.test(id));

        if (input.tableType === 'task') {
          for (const id of rowIds) {
            const t = await Tasks.findOne({ id, fields: ['deletedAt'] }, client);
            if (!t || t.deletedAt) continue;
            await Tasks.update({ id, record: { deletedAt: now, deletedBy } }, client);
            deletedItems++;
          }
        } else {
          for (const id of rowIds) {
            const r = await RecruitmentRows.findOne({ id, fields: ['deletedAt'] }, client);
            if (!r || r.deletedAt) continue;
            await RecruitmentRows.update({ id, record: { deletedAt: now } }, client);
            deletedItems++;
          }
        }
      }

      // Soft-delete all associated cell values
      const { records } = await CellValues.findAll({
        filters: { columnId: input.id },
        fields: ['id'],
        limit: 500,
      }, client);
      for (const cell of records) {
        await CellValues.update({ id: cell.id, record: { deletedAt: now } }, client);
      }

      // Soft-delete the column itself, recording who did it
      await BoardColumns.update({
        id: input.id,
        record: { deletedAt: now, deletedBy },
      }, client);

      await client.query('commit');
      return { success: true, deletedItems };
    } catch (e) {
      try { await client.query('rollback'); } catch { /* la conexión ya murió */ }
      throw e;
    } finally {
      client.release();
    }
  },
});
