import { z } from 'zod';
import { createEndpoint, CalendarEvents } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Batch update rowOrder for calendar events to persist drag-and-drop reordering in the events list',
  inputSchema: z.object({
    updates: z.array(z.object({ id: z.string(), rowOrder: z.number() })).max(1000),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    // Solo toca row_order: no pasa por saveCalendarEvent, así que mover un evento de lugar no marca su invitación como «Por actualizar».
    for (let i = 0; i < input.updates.length; i += 50) {
      const chunk = input.updates.slice(i, i + 50);
      await Promise.all(chunk.map(u => CalendarEvents.update({ id: u.id, record: { rowOrder: u.rowOrder } })));
    }
    return { success: true };
  },
});
