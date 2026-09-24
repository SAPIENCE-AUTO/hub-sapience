import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

// Extraído de getMyMeetingsToday.ts (sep 2026) para reusarlo también en
// getMinutasOverview.ts con un rango de fechas más amplio — mismo query,
// mismo criterio de extracción de link (Teams estructurado, Zoom por regex
// en el body porque el add-in de Outlook no lo expone como campo propio).
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
        return { id: e.id, subject: e.subject ?? 'Sin título', start: e.start.dateTime, end: e.end.dateTime, joinUrl: e.onlineMeeting.joinUrl, provider: 'teams' };
      }
      const zoomUrl = e.body?.content ? extractZoomUrl(e.body.content) : null;
      if (zoomUrl) {
        return { id: e.id, subject: e.subject ?? 'Sin título', start: e.start.dateTime, end: e.end.dateTime, joinUrl: zoomUrl, provider: 'zoom' };
      }
      return null;
    })
    .filter((m): m is CalendarMeeting => m !== null);
}
