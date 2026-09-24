import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

// Piloto notetaker (sep 2026, solo sergio@sapience.com.mx): lista las juntas
// con link de videollamada del día de hoy para el usuario logueado. Teams
// trae el link en un campo estructurado (isOnlineMeeting/onlineMeeting.joinUrl);
// Zoom agendado desde Outlook no tiene campo propio — el link vive embebido
// como texto dentro del body HTML del evento, así que se saca con regex.
const ZOOM_URL_RE = /https?:\/\/[\w.-]*zoom\.us\/(?:j|my)\/\S+?(?=["'<\s])/i;

function extractZoomUrl(bodyHtml: string): string | null {
  const match = bodyHtml.match(ZOOM_URL_RE);
  if (!match) return null;
  // El body es HTML — decodifica las entidades más comunes que rompen la URL.
  return match[0].replace(/&amp;/g, '&');
}

interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingProvider?: string;
  body?: { content?: string };
  isCancelled?: boolean;
}

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

    const url = `${graphMailboxBase(email)}/calendar/calendarView?startDateTime=${encodeURIComponent(startOfDay.toISOString())}&endDateTime=${encodeURIComponent(endOfDay.toISOString())}&$select=id,subject,start,end,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,body,isCancelled&$top=100`;
    const res = await graphFetch(url);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`No se pudo leer el calendario (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { value: GraphEvent[] };

    const meetings = json.value
      .filter(e => !e.isCancelled)
      .map(e => {
        if (e.isOnlineMeeting && e.onlineMeeting?.joinUrl) {
          return { id: e.id, subject: e.subject ?? 'Sin título', start: e.start.dateTime, end: e.end.dateTime, joinUrl: e.onlineMeeting.joinUrl, provider: 'teams' as const };
        }
        const zoomUrl = e.body?.content ? extractZoomUrl(e.body.content) : null;
        if (zoomUrl) {
          return { id: e.id, subject: e.subject ?? 'Sin título', start: e.start.dateTime, end: e.end.dateTime, joinUrl: zoomUrl, provider: 'zoom' as const };
        }
        return null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return { meetings };
  },
});
