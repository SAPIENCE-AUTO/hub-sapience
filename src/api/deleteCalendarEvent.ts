import { z } from 'zod';
import { createEndpoint, CalendarEvents, CalendarAuditLog } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a calendar event and log the action for audit purposes',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    // Fetch event data before deleting for the audit log and Ably notification
    const event = await CalendarEvents.findOne({ id: input.id });

    await CalendarEvents.delete({ id: input.id });

    // Publish realtime delete event (fire-and-forget — must not fail the delete)
    if (event?.projectCode) {
      try {
        await publishEvent(`board:${event.projectCode}`, 'event.deleted', {
          id: input.id,
          projectCode: event.projectCode,
          senderEmail: context.user!.email,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[ably] event.deleted publish failed:', err);
      }
    }

    // Write audit log (fire-and-forget, don't block the response)
    CalendarAuditLog.create({
      record: {
        action: 'Evento eliminado',
        eventName: event?.eventName ?? '(sin nombre)',
        calendarName: event?.calendarName ?? '',
        projectCode: event?.projectCode ?? '',
        userEmail: context.user!.email,
        userName: [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email,
        timestamp: new Date().toISOString(),
        details: `Fecha del evento: ${event?.eventDate ?? 'N/A'} | ID: ${input.id}`,
      },
    }).catch(err => console.error('[CalendarAuditLog] Failed to write delete log:', err));

    return { success: true };
  },
});
