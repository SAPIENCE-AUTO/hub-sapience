import { z } from 'zod';
import { createEndpoint, CalendarEvents } from 'zite-integrations-backend-sdk';

const eventSchema = z.object({
  id: z.string(),
  eventName: z.string().optional(),
  projectCode: z.string().optional(),
  calendarName: z.string().optional(),
  boardId: z.string().optional(),
  eventDate: z.string().optional(),
  durationHours: z.number().optional(),
  location: z.string().optional(),
  attendees: z.string().optional(),
  inviteSent: z.boolean().optional(),
  notes: z.string().optional(),
  parentEventId: z.string().optional(),
  inviteStatus: z.string().optional(),
  outlookEventId: z.string().optional(),
  outlookEventLink: z.string().optional(),
  inviteBodyHtml: z.string().optional(),
  inviteEmails: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get a single calendar event by ID for realtime surgical updates',
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({
    calendarEvent: eventSchema.nullable(),
  }),
  execute: async ({ input }) => {
    const record = await CalendarEvents.findOne({
      id: input.id,
      fields: ['eventName', 'projectCode', 'calendarName', 'boardId', 'eventDate', 'durationHours', 'location', 'attendees', 'inviteSent', 'notes', 'parentEventId', 'inviteStatus', 'outlookEventId', 'outlookEventLink', 'inviteBodyHtml', 'inviteEmails'],
    });

    if (!record) {
      return { calendarEvent: null };
    }

    return {
      calendarEvent: {
        id: record.id,
        eventName: record.eventName,
        projectCode: record.projectCode,
        calendarName: record.calendarName,
        boardId: record.boardId,
        eventDate: record.eventDate,
        durationHours: record.durationHours,
        location: record.location,
        attendees: record.attendees,
        inviteSent: record.inviteSent,
        notes: record.notes,
        parentEventId: record.parentEventId,
        inviteStatus: record.inviteStatus,
        outlookEventId: record.outlookEventId,
        outlookEventLink: record.outlookEventLink,
        inviteBodyHtml: record.inviteBodyHtml,
        inviteEmails: record.inviteEmails,
      },
    };
  },
});
