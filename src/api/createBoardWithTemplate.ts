import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns, Tasks, CellValues } from '../../server/compat';

/**
 * Standard PM timeline tasks with fixed colors. The "Color" column
 * (columnType: 'Color') is rendered by ColorPickerCell, which expects a raw
 * #RRGGBB value — NOT a GROUP_COLORS palette id (those resolve to
 * hsl(var(--group-...)) and are only meaningful for group-coloring, a
 * different feature).
 */
const TEMPLATE_TASKS = [
  { name: 'Go Ahead',                      order: 0, color: '#00B32D' },
  { name: 'Reclutamiento',                 order: 1, color: '#9E9E9E' },
  { name: 'Envío de guía de tópicos',      order: 2, color: '#FFBB00' },
  { name: 'Aprobación de guía de tópicos', order: 3, color: '#FFBB00' },
  { name: 'Fieldwork',                     order: 4, color: '#3D74BD' },
  { name: 'Análisis',                      order: 5, color: '#9E9E9E' },
  { name: 'Reporte',                       order: 6, color: '#DB0000' },
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
  authenticated: true,
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
      columnName: r.columnName ?? null,
      columnType: r.columnType ?? null,
      optionsJson: r.optionsJson ?? null,
      columnOrder: r.columnOrder ?? null,
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
        rowId: r.rowId ?? null,
        columnId: r.columnId ?? null,
        textValue: r.textValue ?? null,
        numberValue: r.numberValue ?? null,
        dateValue: r.dateValue ?? null,
        booleanValue: r.booleanValue ?? null,
        fileUrl: r.fileUrl ?? null,
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
