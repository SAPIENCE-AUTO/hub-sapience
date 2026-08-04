import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Tasks, CalendarEvents, CellValues } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Duplicate a list of rows (recruitment, task, or calendarEvent), copying all fields and dynamic column cell values',
  inputSchema: z.object({
    ids: z.array(z.string()),
    tableType: z.enum(['recruitment', 'task', 'calendarEvent']),
  }),
  outputSchema: z.object({
    createdIds: z.array(z.string()),
    count: z.number(),
  }),
  execute: async ({ input }) => {
    const { ids, tableType } = input;
    const createdIds: string[] = [];

    for (const id of ids) {
      if (tableType === 'recruitment') {
        const orig = await RecruitmentRows.findOne({ id });
        if (!orig) continue;
        const { id: _id, ...rest } = orig;
        const newRow = await RecruitmentRows.create({
          record: {
            ...rest,
            rowName: `${rest.rowName ?? 'Fila'} (copia)`,
            participantName: rest.participantName ? `${rest.participantName} (copia)` : rest.participantName,
          },
        });

        // Copy all dynamic cell values
        const { records: cells } = await CellValues.findAll({ filters: { rowId: id }, limit: 500 });
        for (let i = 0; i < cells.length; i += 50) {
          await CellValues.bulkCreate({
            records: cells.slice(i, i + 50).map(c => ({
              boardId: c.boardId,
              rowId: newRow.id,
              columnId: c.columnId,
              textValue: c.textValue,
              numberValue: c.numberValue,
              dateValue: c.dateValue,
              booleanValue: c.booleanValue,
              fileUrl: c.fileUrl,
            })),
          });
        }

        createdIds.push(newRow.id);
      } else if (tableType === 'calendarEvent') {
        const orig = await CalendarEvents.findOne({ id });
        if (!orig) continue;
        const { id: _id, ...rest } = orig;
        const newEvent = await CalendarEvents.create({
          record: {
            ...rest,
            eventName: `${rest.eventName ?? 'Evento'} (copia)`,
            // Strip Outlook-related fields
            outlookEventId: undefined,
            outlookEventLink: undefined,
            inviteBodyHtml: undefined,
            inviteStatus: undefined,
            inviteSent: undefined,
            inviteEmails: undefined,
          },
        });

        // Copy all dynamic cell values
        const { records: cells } = await CellValues.findAll({ filters: { rowId: id }, limit: 500 });
        for (let i = 0; i < cells.length; i += 50) {
          await CellValues.bulkCreate({
            records: cells.slice(i, i + 50).map(c => ({
              boardId: c.boardId,
              rowId: newEvent.id,
              columnId: c.columnId,
              textValue: c.textValue,
              numberValue: c.numberValue,
              dateValue: c.dateValue,
              booleanValue: c.booleanValue,
              fileUrl: c.fileUrl,
            })),
          });
        }

        createdIds.push(newEvent.id);
      } else {
        const orig = await Tasks.findOne({ id });
        if (!orig) continue;
        const { id: _id, ...rest } = orig;
        const newTask = await Tasks.create({
          record: { ...rest, taskName: `${rest.taskName ?? 'Tarea'} (copia)` },
        });

        // Copy all dynamic cell values
        const { records: cells } = await CellValues.findAll({ filters: { rowId: id }, limit: 500 });
        for (let i = 0; i < cells.length; i += 50) {
          await CellValues.bulkCreate({
            records: cells.slice(i, i + 50).map(c => ({
              boardId: c.boardId,
              rowId: newTask.id,
              columnId: c.columnId,
              textValue: c.textValue,
              numberValue: c.numberValue,
              dateValue: c.dateValue,
              booleanValue: c.booleanValue,
              fileUrl: c.fileUrl,
            })),
          });
        }

        createdIds.push(newTask.id);
      }
    }

    return { createdIds, count: createdIds.length };
  },
});
