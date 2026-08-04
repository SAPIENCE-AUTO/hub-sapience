import { z } from 'zod';
import { createEndpoint, RecruitmentRows, CellValues } from 'zite-integrations-backend-sdk';

/**
 * ONE-TIME REPAIR ENDPOINT
 * Re-denormalizes CellValues back into the cellData field of RecruitmentRows.
 * Run this after the rate-limit storm that corrupted/cleared cellData.
 *
 * Strategy:
 * 1. Page through all RecruitmentRows to find unique (projectCode, boardName) combos.
 * 2. For each unique boardId, fetch all CellValues in one paginated pass.
 * 3. Group CellValues by rowId → rebuild cellData JSON per row.
 * 4. Update each RecruitmentRow in serial batches of 20.
 */
export default createEndpoint({
  authenticated: true,
  description: 'One-time repair: rebuilds cellData on RecruitmentRows from CellValues table.',
  inputSchema: z.object({
    projectCode: z.string().optional(), // limit to one project for safety
    dryRun: z.boolean().optional(),     // if true, only count affected rows
  }),
  outputSchema: z.object({
    rowsScanned: z.number(),
    rowsUpdated: z.number(),
    rowsSkipped: z.number(),
    boardIds: z.array(z.string()),
    cellValuesLoaded: z.number(),
    dryRun: z.boolean(),
    errors: z.number(),
  }),
  execute: async ({ input, context }) => {
    // Only admins
    if (context.user!.role !== 'Owner' && context.user!.role !== 'Socio') {
      throw new Error('Solo administradores pueden ejecutar esta reparación');
    }

    const dryRun = input.dryRun ?? false;

    // ── Step 1: Fetch all RecruitmentRows (paginated) ─────────────────────
    const allRows: Array<{ id: string; projectCode?: string; boardName?: string; cellData?: string }> = [];
    let offset = 0;
    while (true) {
      const filters: Record<string, unknown> = {};
      if (input.projectCode) filters.projectCode = input.projectCode;
      const { records, hasMore } = await RecruitmentRows.findAll({
        filters,
        limit: 2000,
        offset,
        fields: ['id', 'projectCode', 'boardName', 'cellData', 'deletedAt'],
      });
      // Only active rows
      allRows.push(...records.filter(r => !(r as any).deletedAt));
      if (!hasMore) break;
      offset += records.length;
    }

    // ── Step 2: Collect unique boardIds ───────────────────────────────────
    const boardIdSet = new Set<string>();
    for (const r of allRows) {
      if (r.projectCode && r.boardName) {
        boardIdSet.add(`recruitment-${r.projectCode}-${r.boardName}`);
      }
    }
    const boardIds = [...boardIdSet];

    // ── Step 3: Load all CellValues for each boardId ──────────────────────
    // Map: rowId → { columnId → { textValue, numberValue, ... } }
    const cellsByRow = new Map<string, Record<string, Record<string, unknown>>>();
    let totalCellsLoaded = 0;

    for (const boardId of boardIds) {
      let cellOffset = 0;
      while (true) {
        const { records: cells, hasMore } = await CellValues.findAll({
          filters: { boardId },
          limit: 2000,
          offset: cellOffset,
        });
        totalCellsLoaded += cells.length;
        for (const cell of cells) {
          if (!cell.rowId || !cell.columnId) continue;
          if (!cellsByRow.has(cell.rowId)) cellsByRow.set(cell.rowId, {});
          const rowCells = cellsByRow.get(cell.rowId)!;
          // Only store defined non-empty values
          const val: Record<string, unknown> = {};
          if (cell.textValue    !== undefined && cell.textValue    !== null && cell.textValue    !== '') val.textValue    = cell.textValue;
          if (cell.numberValue  !== undefined && cell.numberValue  !== null) val.numberValue  = cell.numberValue;
          if (cell.dateValue    !== undefined && cell.dateValue    !== null && cell.dateValue    !== '') val.dateValue    = cell.dateValue;
          if (cell.booleanValue !== undefined && cell.booleanValue !== null) val.booleanValue = cell.booleanValue;
          if (cell.fileUrl      !== undefined && cell.fileUrl      !== null && cell.fileUrl      !== '') val.fileUrl      = cell.fileUrl;
          if (Object.keys(val).length > 0) {
            rowCells[cell.columnId] = val;
          }
        }
        if (!hasMore) break;
        cellOffset += cells.length;
        // Small pause between pages to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // ── Step 4: Update each row with reconstructed cellData ───────────────
    let rowsUpdated = 0;
    let rowsSkipped = 0;
    let errors = 0;

    const BATCH_SIZE = 20;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (row) => {
        const cells = cellsByRow.get(row.id) ?? {};
        const newCellData = JSON.stringify(cells);

        // Skip if cellData is already correct (avoid unnecessary writes)
        if (row.cellData === newCellData) {
          rowsSkipped++;
          return;
        }
        // Skip rows with no cells and already empty cellData
        if (Object.keys(cells).length === 0 && (!row.cellData || row.cellData === '{}' || row.cellData === 'null')) {
          rowsSkipped++;
          return;
        }

        if (dryRun) {
          rowsUpdated++;
          return;
        }

        try {
          await RecruitmentRows.update({ id: row.id, record: { cellData: newCellData } });
          rowsUpdated++;
        } catch {
          errors++;
        }
      }));

      // Small pause between batches
      if (i + BATCH_SIZE < allRows.length) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    return {
      rowsScanned: allRows.length,
      rowsUpdated,
      rowsSkipped,
      boardIds,
      cellValuesLoaded: totalCellsLoaded,
      dryRun,
      errors,
    };
  },
});
