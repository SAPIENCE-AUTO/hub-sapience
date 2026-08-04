import { z } from 'zod';
import { createEndpoint, Tasks } from 'zite-integrations-backend-sdk';

const taskSchema = z.object({
  id: z.string(),
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
});

export default createEndpoint({
  authenticated: true,
  description: 'Get a single task by ID for realtime surgical updates',
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({
    task: taskSchema.nullable(),
  }),
  execute: async ({ input }) => {
    const record = await Tasks.findOne({
      id: input.id,
      fields: ['taskName', 'projectCode', 'boardName', 'boardId', 'status', 'assignedTo', 'startDate', 'endDate', 'parentTaskId', 'order', 'notes'],
    });

    if (!record) {
      return { task: null };
    }

    return {
      task: {
        id: record.id,
        taskName: record.taskName,
        projectCode: record.projectCode,
        boardName: record.boardName,
        boardId: record.boardId,
        status: record.status,
        assignedTo: record.assignedTo,
        startDate: record.startDate,
        endDate: record.endDate,
        parentTaskId: record.parentTaskId,
        order: record.order,
        notes: record.notes,
      },
    };
  },
});
