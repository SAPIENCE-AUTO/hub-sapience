import { z } from 'zod';
import { createEndpoint, RecruitmentRows, BoardColumns, CellValues, Tasks } from '../../server/compat';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

function isExpired(deletedAt: string): boolean {
  if (!deletedAt) return false;
  try {
    return Date.now() - new Date(deletedAt).getTime() > TEN_DAYS_MS;
  } catch {
    return false;
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Permanently delete items that have been in trash for more than 10 days',
  inputSchema: z.object({}),
  outputSchema: z.object({ deleted: z.number() }),
  execute: async () => {
    let deleted = 0;

    // ── Rows ─────────────────────────────────────────────────────────────
    const { records: rows } = await RecruitmentRows.findAll({
      filters: { deletedAt: { not: '' } },
      fields: ['id', 'deletedAt'],
      limit: 500,
    });
    const expiredRows = rows.filter(r => r.deletedAt && isExpired(r.deletedAt)).slice(0, 50);
    for (const row of expiredRows) {
      await RecruitmentRows.delete({ id: row.id });
      await sleep(30);
      deleted++;
    }

    if (deleted >= 50) return { deleted };

    // ── Tasks ────────────────────────────────────────────────────────────
    // deletedAt es timestamptz real (no 'text' como el resto, ver
    // generate.py) — usa isNotEmpty en vez de `not: ''`, que compararía
    // el timestamp contra un string vacío y tronaría en Postgres.
    await sleep(200);
    const { records: tasks } = await Tasks.findAll({
      filters: { deletedAt: { isNotEmpty: true } } as any,
      fields: ['id', 'deletedAt'],
      limit: 500,
    });
    const expiredTasks = tasks.filter(t => t.deletedAt && isExpired(t.deletedAt)).slice(0, 50 - deleted);
    for (const task of expiredTasks) {
      await Tasks.delete({ id: task.id });
      await sleep(30);
      deleted++;
    }

    if (deleted >= 50) return { deleted };

    // ── Columns ───────────────────────────────────────────────────────────
    await sleep(200);
    const { records: cols } = await BoardColumns.findAll({
      filters: { deletedAt: { not: '' } },
      fields: ['id', 'deletedAt'],
      limit: 500,
    });
    const expiredCols = cols.filter(c => c.deletedAt && isExpired(c.deletedAt)).slice(0, 50 - deleted);
    for (const col of expiredCols) {
      await BoardColumns.delete({ id: col.id });
      await sleep(30);
      deleted++;
    }

    if (deleted >= 50) return { deleted };

    // ── Cells ─────────────────────────────────────────────────────────────
    await sleep(200);
    const { records: cells } = await CellValues.findAll({
      filters: { deletedAt: { not: '' } },
      fields: ['id', 'deletedAt'],
      limit: 500,
    });
    const expiredCells = cells.filter(c => c.deletedAt && isExpired(c.deletedAt)).slice(0, 50 - deleted);
    for (const cell of expiredCells) {
      await CellValues.delete({ id: cell.id });
      await sleep(30);
      deleted++;
    }

    return { deleted };
  },
});
