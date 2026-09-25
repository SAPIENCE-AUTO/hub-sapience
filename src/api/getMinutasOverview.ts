import { z } from 'zod';
import { createEndpoint, MeetingRecordings } from '../../server/compat';
import { fetchCalendarMeetings } from '../serverUtils/graphMeetings';
import { attemptTranscriptionRecovery } from '../serverUtils/transcriptionRecovery';

const recordingSummarySchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  assemblyTranscriptId: z.string().optional(),
  hasTranscript: z.boolean(),
  project: z.array(z.string()).optional(),
  deal: z.array(z.string()).optional(),
});

const sessionSchema = z.object({
  key: z.string(),
  subject: z.string(),
  start: z.string(),
  end: z.string(),
  joinUrl: z.string().optional(),
  provider: z.enum(['teams', 'zoom']).optional(),
  graphEventId: z.string().optional(),
  recording: recordingSummarySchema.optional(),
});

const DAYS_PAST = 7;
const DAYS_FUTURE = 14;

// "necesito que sea infalible" (Sergio, tras "Ajustes LRP" quedarse con
// video pero sin transcripción sin que nadie se enterara) — cada vez que
// alguien abre/refresca Minutas (esta vista hace polling cada 60s mientras
// la página está abierta), de paso revisa si alguna de sus grabaciones
// quedó atorada y la reintenta sola, sin que haya que pedirlo a mano. El
// cooldown evita reintentar la misma fila en cada poll mientras el intento
// anterior sigue en curso (la recuperación puede tardar ~1 min esperando el
// rendition de audio de Mux).
const STUCK_RETRY_COOLDOWN_MS = 3 * 60 * 1000;

// Minutas / notetaker (sep 2026): "apartado de minutas donde vengan todas
// las sesiones (pasadas, ongoing y futuras)... si ya está vinculada... o
// vincular ahí mismo" (Sergio) — fusiona el calendario real (Graph, mismo
// query que getMyMeetingsToday.ts pero en un rango más amplio) con las
// filas de meeting_recordings del usuario, para que todo viva en un solo
// lugar en vez de repartido entre "Mis juntas de hoy" y "Minutas sin
// vincular". Correlaciona por graphEventId cuando existe (filas nuevas); las
// filas viejas o subidas a mano, sin ese campo, se muestran como sesiones
// propias sin intentar adivinar a qué evento de calendario pertenecen — es
// mejor mostrarlas de más que perderlas.
export default createEndpoint({
  authenticated: true,
  description: 'Vista unificada de minutas: calendario (pasado/hoy/futuro) + grabaciones propias, con su estado de vínculo',
  inputSchema: z.object({}),
  outputSchema: z.object({ sessions: z.array(sessionSchema) }),
  execute: async ({ context }) => {
    const email = context.user!.email;
    const now = new Date();
    const rangeStart = new Date(now.getTime() - DAYS_PAST * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(now.getTime() + DAYS_FUTURE * 24 * 60 * 60 * 1000);

    const [calendarMeetings, { records: rawRecordings }] = await Promise.all([
      fetchCalendarMeetings(email, rangeStart, rangeEnd).catch(() => []),
      MeetingRecordings.findAll({
        filters: { ownerEmail: email },
        sorts: [{ field: 'createdAt', direction: 'desc' }],
        fields: [
          'graphEventId', 'subject', 'meetingStart', 'meetingEnd', 'status',
          'muxPlaybackId', 'muxAssetId', 'assemblyTranscriptId', 'transcript', 'project', 'deal', 'updatedAt',
        ],
      }),
    ]);

    // Self-heal: video listo, sin transcripción, y ya sea que quedó
    // marcada explícitamente en error o simplemente lleva demasiado sin
    // avanzar — se reintenta en segundo plano (fire-and-forget, nunca
    // bloquea esta respuesta). Mismo mecanismo que el botón manual de
    // retryMeetingTranscription.ts.
    for (const r of rawRecordings) {
      const staleEnough = r.updatedAt && Date.now() - new Date(r.updatedAt).getTime() > STUCK_RETRY_COOLDOWN_MS;
      const stuck = r.muxPlaybackId && r.muxAssetId && !r.assemblyTranscriptId && !r.transcript &&
        (r.status === 'transcription_error' || staleEnough);
      if (stuck) {
        attemptTranscriptionRecovery(r).catch(err =>
          console.error('[getMinutasOverview] self-heal de transcripción falló', r.id, (err as Error).message),
        );
      }
    }

    // Payload liviano a propósito: esta vista es una lista, no el detalle —
    // el transcript completo (puede ser texto larguísimo) nunca se necesita
    // aquí, solo saber si ya existe.
    const recordings = rawRecordings.map(r => ({ ...r, hasTranscript: !!r.transcript, transcript: undefined }));

    // Graph regresa start.dateTime SIN offset ("2026-09-24T16:00:00.0000000")
    // — Date lo interpretaría como hora LOCAL del server, no UTC, mientras
    // que meeting_start en Postgres sí sale con 'Z'. Se normaliza a ISO con
    // 'Z' tanto para comparar acá como para lo que recibe el cliente — así
    // el front nunca tiene que lidiar con esta ambigüedad de Graph.
    const toUtcIso = (iso: string) => new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toISOString();
    const toUtcMs = (iso: string) => new Date(toUtcIso(iso)).getTime();

    const usedRecordingIds = new Set<string>();
    const findRecordingFor = (graphEventId: string, subject: string, start: string) => {
      let match = recordings.find(r => r.graphEventId && r.graphEventId === graphEventId);
      if (!match) {
        // Fallback para filas de antes de graphEventId (o subidas a mano
        // cuyo asunto coincide por casualidad con un evento real): mismo
        // asunto y arranque dentro de 5 minutos.
        match = recordings.find(r =>
          !r.graphEventId && r.subject === subject && r.meetingStart &&
          Math.abs(toUtcMs(r.meetingStart) - toUtcMs(start)) < 5 * 60 * 1000,
        );
      }
      if (match) usedRecordingIds.add(match.id);
      return match;
    };

    const sessions = calendarMeetings.map(m => {
      const recording = findRecordingFor(m.id, m.subject, m.start);
      return {
        key: `cal-${m.id}`,
        subject: m.subject,
        start: toUtcIso(m.start),
        end: toUtcIso(m.end),
        joinUrl: m.joinUrl,
        provider: m.provider,
        graphEventId: m.id,
        recording,
      };
    });

    // Grabaciones que no calzaron con ningún evento del rango del calendario
    // (subidas a mano, o notetaker agregado a algo fuera de este rango) —
    // se muestran igual, como su propia sesión.
    const standalone = recordings
      .filter(r => !usedRecordingIds.has(r.id))
      .map(r => ({
        key: `rec-${r.id}`,
        subject: r.subject ?? 'Sin título',
        start: r.meetingStart ?? '',
        end: r.meetingEnd ?? '',
        recording: r,
      }));

    const all = [...sessions, ...standalone].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    return { sessions: all };
  },
});
