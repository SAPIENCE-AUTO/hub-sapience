import { z } from 'zod';
import { createEndpoint, Tasks } from '../../server/compat';
import { publishEvent } from '../lib/ably';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a task',
  inputSchema: z.object({
    id: z.string().optional(),
    taskName: z.string().optional(),
    projectCode: z.string().optional(),
    boardName: z.string().optional(),
    boardId: z.string().optional(),
    status: z.string().optional(),
    assignedTo: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    parentTaskId: z.string().optional(),
    order: z.number().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string(), boardId: z.string().optional() }),
  execute: async ({ input, context }) => {
    const { id, boardId: inputBoardId, ...fields } = input;
    if (id) {
      await Tasks.update({ id, record: fields as any });

      // Publish board.field.updated for real-time sync
      try {
        let projectCode = fields.projectCode;
        let boardName = fields.boardName;
        let resolvedBoardId = inputBoardId;
        if (!projectCode || !boardName || !resolvedBoardId) {
          const task = await Tasks.findOne({ id });
          projectCode = projectCode ?? task?.projectCode ?? undefined;
          boardName = boardName ?? task?.boardName ?? undefined;
          resolvedBoardId = resolvedBoardId ?? (task as any)?.boardId ?? undefined;
        }
        if (projectCode && (resolvedBoardId || boardName)) {
          const ablyBoardId = resolvedBoardId || `pm-${projectCode}-${boardName}`;
          const updatedFields = Object.fromEntries(
            Object.entries(fields as Record<string, unknown>).filter(
              ([k, v]) => v !== undefined && k !== 'id' && k !== 'projectCode' && k !== 'boardName'
            )
          );
          if (Object.keys(updatedFields).length > 0) {
            await publishEvent(`board:${projectCode}`, 'board.field.updated', {
              projectCode,
              boardId: ablyBoardId,
              entityType: 'task',
              fieldType: 'fixed',
              rowId: id,
              fields: updatedFields,
              senderEmail: context.user!.email,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch { /* fire and forget */ }

      return { success: true, id, boardId: inputBoardId };
    }

    // Resolve boardId: use input.boardId directly if provided (UUID-first),
    // otherwise fall back to legacy lookup by projectCode + boardName
    let boardIdUUID: string | undefined = inputBoardId;
    if (!boardIdUUID && fields.projectCode && fields.boardName) {
      const lookup = await lookupBoardUUID(fields.projectCode, fields.boardName, 'pm');
      if (lookup.found && lookup.uuid) {
        boardIdUUID = lookup.uuid;
      } else {
        console.warn('[saveTask] boardId lookup failed, leaving empty', { projectCode: fields.projectCode, boardName: fields.boardName, reason: lookup.reason });
      }
    }
    const record = await Tasks.create({ record: { ...fields, boardId: boardIdUUID } as any });
    return { success: true, id: record.id, boardId: boardIdUUID };
  },
});
