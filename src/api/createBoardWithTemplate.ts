import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns, Tasks, CellValues } from 'zite-integrations-backend-sdk';

/**
 * Standard PM timeline tasks with assigned colors from GROUP_COLORS palette.
 * Colors chosen to best match the target palette:
 *   #00B32D (verde)  → green-3
 *   #9E9E9E (gris)   → orange-1 (no gray exists; neutral warm tone)
 *   #FFBB00 (amarillo) → yellow-3
 *   #3D74BD (azul)   → blue-3
 *   #DB0000 (rojo)   → red-3
 */
const TEMPLATE_TASKS = [
  { name: 'Go Ahead',                      order: 0, color: 'green-3'  },
  { name: 'Reclutamiento',                 order: 1, color: 'orange-1' },
  { name: 'Envío de guía de tópicos',      order: 2, color: 'yellow-3' },
  { name: 'Aprobación de guía de tópicos', order: 3, color: 'yellow-3' },
  { name: 'Fieldwork',                     order: 4, color: 'blue-3'   },
  { name: 'Análisis',                      order: 5, color: 'orange-1' },
  { name: 'Reporte',                       order: 6, color: 'red-3'    },
];

const columnSchema = z.object({
  id: z.string(),
  boardId: z.string().optional().nullable(),
  columnName: z.string().optional().nullable(),
  columnType: z.string().optional().nullable(),
  optionsJson: z.string().optional().nullable(),
  columnOrder: z.number().optional().nullable(),
});

const cellValueSchema = z.object({
  id: z.string(),
  boardId: z.string().optional().nullable(),
  rowId: z.string().optional().nullable(),
  columnId: z.string().optional().nullable(),
  textValue: z.string().optional().nullable(),
  numberValue: z.number().optional().nullable(),
  dateValue: z.string().optional().nullable(),
  booleanValue: z.boolean().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
});

export default createEndpoint({
  description: 'Creates a new PM timeline board with default columns and 7 standard tasks with colors, all in a single call',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string(),
    boardOrder: z.number(),
    boardType: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    /** Legacy composite ID — used by the frontend for cache keys and display */
    boardId: z.string(),
    /** Same as boardId — the legacy composite (pm-{projectCode}-{boardName}) */
    legacyBoardId: z.string(),
    /** The real UUID of the Boards record — used for DB writes going forward */
    uuidBoardId: z.string(),
    /** Alias for uuidBoardId — canonical ID to use in future migrations */
    canonicalBoardId: z.string(),
    tasks: z.array(z.object({ id: z.string(), name: z.string(), order: z.number() })),
    columns: z.array(columnSchema),
    cellValues: z.array(cellValueSchema),
  }),
  execute: async ({ input }) => {
    // ── 1. Derive both IDs up front ──────────────────────────────────────────
    const legacyBoardId = `pm-${input.projectCode}-${input.boardName}`;

    // ── 2. Create the Board record and capture the real UUID ─────────────────
    const createdBoard = await Boards.create({
      record: {
        boardName: input.boardName,
        projectCode: input.projectCode,
        boardOrder: input.boardOrder,
        boardType: input.boardType,
      },
    });

    const uuidBoardId = createdBoard.id;

    // ── 3. Create the 3 default columns — written under the UUID ─────────────
    const statusOptions = JSON.stringify([
      { label: 'Pendiente',   color: 'gray'  },
      { label: 'En progreso', color: 'blue'  },
      { label: 'Completada',  color: 'green' },
      { label: 'Bloqueada',   color: 'red'   },
    ]);

    const columnsResult = await BoardColumns.bulkCreate({
      records: [
        { boardId: uuidBoardId, columnName: 'Estado',      columnType: 'Status', columnOrder: 500,  optionsJson: statusOptions },
        { boardId: uuidBoardId, columnName: 'Responsable', columnType: 'Persona', columnOrder: 1000 },
        { boardId: uuidBoardId, columnName: 'Color',       columnType: 'Color',   columnOrder: 1500 },
      ],
    });

    // Return columns with boardId = legacyBoardId so preSeedBoardCache receives
    // data consistent with the legacy cache key used by the frontend.
    const columns = columnsResult.records.map(r => ({
      id: r.id,
      boardId: legacyBoardId,           // ← defensive: always legacy in response
      columnName: r.fields.columnName ?? null,
      columnType: r.fields.columnType ?? null,
      optionsJson: r.fields.optionsJson ?? null,
      columnOrder: r.fields.columnOrder ?? null,
    }));

    const colorColumn = columns.find(c => c.columnType === 'Color');

    // ── 4. Create the 7 standard tasks ───────────────────────────────────────
    const tasksResult = await Tasks.bulkCreate({
      records: TEMPLATE_TASKS.map(t => ({
        taskName: t.name,
        projectCode: input.projectCode,
        boardName: input.boardName,
        boardId: uuidBoardId,
        order: t.order,
        status: 'Pendiente',
        parentTaskId: '',
      })),
    });

    const tasks = tasksResult.records.map((r, i) => ({
      id: r.id,
      name: TEMPLATE_TASKS[i].name,
      order: TEMPLATE_TASKS[i].order,
    }));

    // ── 5. Create color CellValues — written under the UUID ──────────────────
    type CellValueItem = {
      id: string;
      boardId?: string | null;
      rowId?: string | null;
      columnId?: string | null;
      textValue?: string | null;
      numberValue?: number | null;
      dateValue?: string | null;
      booleanValue?: boolean | null;
      fileUrl?: string | null;
    };

    let cellValues: CellValueItem[] = [];
    if (colorColumn) {
      const cellValuesResult = await CellValues.bulkCreate({
        records: tasks.map((task, i) => ({
          boardId: uuidBoardId,          // ← written to DB under UUID
          rowId: task.id,
          columnId: colorColumn.id,
          textValue: TEMPLATE_TASKS[i].color,
        })),
      });

      // Return cellValues with boardId = legacyBoardId for the same reason as
      // columns above — consistency with the legacy cache key in preSeedBoardCache.
      cellValues = cellValuesResult.records.map(r => ({
        id: r.id,
        boardId: legacyBoardId,          // ← defensive: always legacy in response
        rowId: r.fields.rowId ?? null,
        columnId: r.fields.columnId ?? null,
        textValue: r.fields.textValue ?? null,
        numberValue: r.fields.numberValue ?? null,
        dateValue: r.fields.dateValue ?? null,
        booleanValue: r.fields.booleanValue ?? null,
        fileUrl: r.fields.fileUrl ?? null,
      }));
    }

    return {
      success: true,
      boardId: legacyBoardId,           // compat: frontend uses this for cache key
      legacyBoardId,                    // explicit alias
      uuidBoardId,                      // real DB UUID — for debugging / future use
      canonicalBoardId: uuidBoardId,    // canonical alias
      tasks,
      columns,
      cellValues,
    };
  },
});
