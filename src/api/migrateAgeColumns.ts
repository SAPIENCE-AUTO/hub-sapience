import { z } from 'zod';
import { createEndpoint, RecruitmentRows } from 'zite-integrations-backend-sdk';

// Fillout source IDs (old — data lives here)
const OLD_EDAD_ID   = '19eecefa-abd1-4688-8e65-eed462d551f4';
const OLD_RANGO_ID  = 'f1f4570d-3bdc-40e8-ad84-da6815b0e2fe';

// BoardColumns target IDs (new — where the board displays the data)
const NEW_EDAD_ID   = '9c6f85a2-6778-4379-b607-f2af585f2d43';
const NEW_RANGO_ID  = '24102bdb-0239-4d07-9de6-fe5f252a3cc8';

const BOARD_ID = 'recruitment-FESTIVAL-Status';

export default createEndpoint({
  description: 'Migra los valores de Edad y Rango de edad del tablero FESTIVAL de los IDs de Fillout a los IDs de BoardColumns',
  inputSchema: z.object({
    dryRun: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    total: z.number(),
    updated: z.number(),
    skipped: z.number(),
    dryRun: z.boolean(),
    preview: z.array(z.object({
      rowId: z.string(),
      edad: z.number().nullable(),
      rangoEdad: z.string().nullable(),
    })).optional(),
  }),
  execute: async ({ input }) => {
    let total = 0;
    let updated = 0;
    let skipped = 0;
    const preview: { rowId: string; edad: number | null; rangoEdad: string | null }[] = [];

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const page = await RecruitmentRows.findAll({
        filters: { boardName: BOARD_ID },
        fields: ['cellData', 'boardId'],
        limit: 200,
        offset,
      });

      hasMore = page.hasMore;
      offset += page.records.length;

      for (const row of page.records) {
        total++;

        let cellData: Record<string, { textValue?: string; numberValue?: number; dateValue?: string; booleanValue?: boolean; fileUrl?: string }> = {};

        if (row.cellData) {
          try {
            cellData = JSON.parse(row.cellData);
          } catch {
            skipped++;
            continue;
          }
        }

        const oldEdadEntry  = cellData[OLD_EDAD_ID];
        const oldRangoEntry = cellData[OLD_RANGO_ID];

        // Nothing to migrate for this row
        if (!oldEdadEntry && !oldRangoEntry) {
          skipped++;
          continue;
        }

        // Skip if target columns already have data
        const targetEdadAlready  = cellData[NEW_EDAD_ID];
        const targetRangoAlready = cellData[NEW_RANGO_ID];
        if (targetEdadAlready || targetRangoAlready) {
          skipped++;
          continue;
        }

        // Parse edad as number (stored as textValue from Fillout)
        let edadNumber: number | null = null;
        if (oldEdadEntry) {
          const raw = oldEdadEntry.numberValue ?? (oldEdadEntry.textValue ? parseFloat(oldEdadEntry.textValue) : NaN);
          if (!isNaN(raw as number)) edadNumber = raw as number;
        }

        const rangoText: string | null = oldRangoEntry?.textValue ?? null;

        if (input.dryRun) {
          preview.push({ rowId: row.id, edad: edadNumber, rangoEdad: rangoText });
          updated++;
          continue;
        }

        // Build updated cellData with new target IDs
        const newCellData = { ...cellData };
        if (edadNumber !== null) {
          newCellData[NEW_EDAD_ID] = { numberValue: edadNumber };
        }
        if (rangoText) {
          newCellData[NEW_RANGO_ID] = { textValue: rangoText };
        }

        await RecruitmentRows.update({
          id: row.id,
          record: { cellData: JSON.stringify(newCellData) },
        });

        updated++;
      }
    }

    return {
      total,
      updated,
      skipped,
      dryRun: input.dryRun ?? false,
      ...(input.dryRun ? { preview } : {}),
    };
  },
});
