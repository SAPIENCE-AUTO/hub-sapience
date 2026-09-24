import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { fetchCalendarMeetings } from '../serverUtils/graphMeetings';

// Piloto notetaker (sep 2026, solo sergio@sapience.com.mx): lista las juntas
// con link de videollamada del día de hoy para el usuario logueado. Query
// compartido con getMinutasOverview.ts (fetchCalendarMeetings), acá acotado
// al día de hoy nada más — este endpoint es el widget rápido del Dashboard,
// getMinutasOverview.ts es la vista completa (pasadas/ongoing/futuras +
// estado de vínculo).
export default createEndpoint({
  authenticated: true,
  description: 'Piloto notetaker: juntas de hoy del usuario logueado con link de videollamada (Teams u Zoom)',
  inputSchema: z.object({}),
  outputSchema: z.object({
    meetings: z.array(z.object({
      id: z.string(),
      subject: z.string(),
      start: z.string(),
      end: z.string(),
      joinUrl: z.string(),
      provider: z.enum(['teams', 'zoom']),
    })),
  }),
  execute: async ({ context }) => {
    const email = context.user!.email;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const meetings = await fetchCalendarMeetings(email, startOfDay, endOfDay);
    return { meetings };
  },
});
