import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

// Query compartido por getMinutasOverview.ts — criterio de extracción de
// link: Teams estructurado, Zoom por regex en el body porque el add-in de
// Outlook no lo expone como campo propio.
const ZOOM_URL_RE = /https?:\/\/[\w.-]*zoom\.us\/(?:j|my)\/\S+?(?=["'<\s])/i;

function extractZoomUrl(bodyHtml: string): string | null {
  const match = bodyHtml.match(ZOOM_URL_RE);
  if (!match) return null;
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

export interface CalendarMeeting {
  id: string;
  subject: string;
  start: string;
  end: string;
  joinUrl: string;
  provider: 'teams' | 'zoom';
}

// Graph regresa start.dateTime SIN offset ("2026-09-24T16:00:00.0000000") —
// Date lo interpretaría como hora LOCAL del proceso que lo lee, no UTC (que
// es lo que Graph realmente manda por default, sin pedir un Prefer:
// outlook.timezone). Se normaliza AQUÍ, en la única fuente compartida, para
// que ningún caller nuevo pueda repetir el bug por no acordarse de aplicarlo
// — "me las mostraba como zona utc 0 y no como hora de cdmx" (Sergio) fue
// justo eso: un caller anterior de este mismo helper nunca tuvo el fix.
function toUtcIso(iso: string): string {
  return new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toISOString();
}

export async function fetchCalendarMeetings(email: string, startDate: Date, endDate: Date): Promise<CalendarMeeting[]> {
  const url = `${graphMailboxBase(email)}/calendar/calendarView?startDateTime=${encodeURIComponent(startDate.toISOString())}&endDateTime=${encodeURIComponent(endDate.toISOString())}&$select=id,subject,start,end,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,body,isCancelled&$top=200`;
  const res = await graphFetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`No se pudo leer el calendario (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { value: GraphEvent[] };

  return json.value
    .filter(e => !e.isCancelled)
    .map((e): CalendarMeeting | null => {
      if (e.isOnlineMeeting && e.onlineMeeting?.joinUrl) {
        return { id: e.id, subject: e.subject ?? 'Sin título', start: toUtcIso(e.start.dateTime), end: toUtcIso(e.end.dateTime), joinUrl: e.onlineMeeting.joinUrl, provider: 'teams' };
      }
      const zoomUrl = e.body?.content ? extractZoomUrl(e.body.content) : null;
      if (zoomUrl) {
        return { id: e.id, subject: e.subject ?? 'Sin título', start: toUtcIso(e.start.dateTime), end: toUtcIso(e.end.dateTime), joinUrl: zoomUrl, provider: 'zoom' };
      }
      return null;
    })
    .filter((m): m is CalendarMeeting => m !== null);
}
