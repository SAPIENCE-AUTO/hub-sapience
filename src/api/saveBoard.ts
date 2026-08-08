import { z } from 'zod';
import { createEndpoint, Boards } from '../../server/compat';
import { ensureCalendarDefaultColumns } from '../serverUtils/calendarDefaults';

const columnSchema = z.object({
  id: z.string(),
  boardId: z.string().optional(),
  columnName: z.string().optional(),
  columnType: z.string().optional(),
  optionsJson: z.string().optional(),
  columnOrder: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a board record (updates boardOrder if board already exists). Use forceCreate=true to always create a new board with a fresh UUID (e.g. for calendars with duplicate names).',
  inputSchema: z.object({
    boardId: z.string().optional(),
    boardName: z.string(),
    projectCode: z.string(),
    boardOrder: z.number().optional(),
    boardType: z.string().optional(),
    forceCreate: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    boardName: z.string(),
    columns: z.array(columnSchema).optional(),
  }),
  execute: async ({ input }) => {
    // Direct update by UUID — skip name-based lookup
    if (input.boardId && !input.forceCreate) {
      const updateRecord: Record<string, any> = {};
      if (input.boardOrder !== undefined) updateRecord.boardOrder = input.boardOrder;
      if (input.boardType) updateRecord.boardType = input.boardType;
      if (input.boardName) updateRecord.boardName = input.boardName;
      if (Object.keys(updateRecord).length > 0) {
        await Boards.update({ id: input.boardId, record: updateRecord as any });
      }
      return { id: input.boardId, boardName: input.boardName };
    }

    // forceCreate: skip find-existing, always create a new Board with fresh UUID
    if (input.forceCreate) {
      const created = await Boards.create({
        record: {
          boardName: input.boardName,
          projectCode: input.projectCode,
          boardOrder: input.boardOrder ?? 0,
          ...(input.boardType ? { boardType: input.boardType } : {}),
        } as any,
      });

      // ── Auto-create default columns for calendar boards ─────────────────
      if (input.boardType === 'calendar') {
        const columns = await ensureCalendarDefaultColumns(created.id);
        if (columns.length > 0) {
          return { id: created.id, boardName: created.boardName ?? input.boardName, columns };
        }
      }

      return { id: created.id, boardName: created.boardName ?? input.boardName };
    }

    // Default upsert: find existing by projectCode + boardName (+ boardType if provided)
    const filters: Record<string, string> = {
      boardName: input.boardName,
      projectCode: input.projectCode,
    };
    if (input.boardType) {
      filters.boardType = input.boardType;
    }

    const { records } = await Boards.findAll({ filters: filters as any, limit: 1 });
    const existing = records.find(r => !r.deletedAt);

    if (existing) {
      // Update boardOrder (and boardType if provided) on existing board
      const updateRecord: Record<string, any> = {};
      if (input.boardOrder !== undefined) updateRecord.boardOrder = input.boardOrder;
      if (input.boardType) updateRecord.boardType = input.boardType;
      if (Object.keys(updateRecord).length > 0) {
        await Boards.update({ id: existing.id, record: updateRecord as any });
      }
      return { id: existing.id, boardName: existing.boardName ?? input.boardName };
    }

    const created = await Boards.create({
      record: {
        boardName: input.boardName,
        projectCode: input.projectCode,
        boardOrder: input.boardOrder ?? 0,
        ...(input.boardType ? { boardType: input.boardType } : {}),
      } as any,
    });

    return { id: created.id, boardName: created.boardName ?? input.boardName };
  },
});
