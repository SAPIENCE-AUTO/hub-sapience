import { z } from 'zod';
import { createEndpoint, MeetingRecordings, Users, Projects } from '../../server/compat';
import { fetchCalendarMeetings } from '../serverUtils/graphMeetings';
import { attemptTranscriptionRecovery } from '../serverUtils/transcriptionRecovery';

const RECORDING_FIELDS = [
  'graphEventId', 'subject', 'meetingStart', 'meetingEnd', 'status',
  'muxPlaybackId', 'muxAssetId', 'assemblyTranscriptId', 'transcript', 'project', 'deal', 'updatedAt',
] as const;

// "de inicio en esa sección puedan ver solo aquellas en las que ellos
// estuvieron... y ya si está vinculada a un proyecto, pues acceso general"
// (Sergio) — además de las minutas propias (ownerEmail), cualquiera que sea
// líder o analista de un proyecto ve TAMBIÉN las minutas ya vinculadas a
// ese proyecto, aunque no las haya grabado él. Los deals se quedan
// exactamente como antes (sin ampliar) — es información comercial, mismo
// criterio que DEAL_LINK_ALLOWED_EMAILS en LinkMeetingRecordingPopover.tsx.
async function resolveMyProjectIds(email: string): Promise<string[]> {
  const { records: userRows } = await Users.findAll({ filters: { email }, fields: ['id'], limit: 1 });
  const userId = userRows[0]?.id;
  if (!userId) return [];

  const { records: projects } = await Projects.findAll({ fields: ['lider', 'analistas'], limit: 2000 });
  return projects
    .filter(p => p.lider === userId || (p.analistas ?? []).includes(userId))
    .map(p => p.id);
}

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
// vincular ahí mismo" (Sergio) — fusiona el calendario real (Graph) con las
// filas de meeting_recordings propias y las de proyectos donde el usuario es
// líder/analista, para que todo viva en un solo lugar. Correlaciona por
// graphEventId cuando existe (filas nuevas); las filas viejas o subidas a
// mano, sin ese campo, se muestran como sesiones propias sin intentar
// adivinar a qué evento de calendario pertenecen — es mejor mostrarlas de
// más que perderlas.
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

    const [calendarMeetings, { records: ownRecordings }, myProjectIds] = await Promise.all([
      fetchCalendarMeetings(email, rangeStart, rangeEnd).catch(() => []),
      MeetingRecordings.findAll({
        filters: { ownerEmail: email },
        sorts: [{ field: 'createdAt', direction: 'desc' }],
        fields: [...RECORDING_FIELDS],
      }),
      resolveMyProjectIds(email).catch(() => [] as string[]),
    ]);

    // Self-heal solo sobre las propias — si alguien más del equipo abre
    // Minutas y ve una minuta ajena vinculada a su proyecto, no hace falta
    // que TAMBIÉN dispare su propio intento de recuperación (el cooldown ya
    // lo evita en parte, pero mejor ni arriesgar llamadas redundantes a
    // AssemblyAI). Mismo mecanismo que el botón manual de
    // retryMeetingTranscription.ts.
    for (const r of ownRecordings) {
      const staleEnough = r.updatedAt && Date.now() - new Date(r.updatedAt).getTime() > STUCK_RETRY_COOLDOWN_MS;
      const stuck = r.muxPlaybackId && r.muxAssetId && !r.assemblyTranscriptId && !r.transcript &&
        (r.status === 'transcription_error' || staleEnough);
      if (stuck) {
        attemptTranscriptionRecovery(r).catch(err =>
          console.error('[getMinutasOverview] self-heal de transcripción falló', r.id, (err as Error).message),
        );
      }
    }

    const { records: teamRecordings } = myProjectIds.length > 0
      ? await MeetingRecordings.findAll({
          filters: { project: { in: myProjectIds } as any },
          sorts: [{ field: 'createdAt', direction: 'desc' }],
          fields: [...RECORDING_FIELDS],
        })
      : { records: [] as typeof ownRecordings };

    const ownIds = new Set(ownRecordings.map(r => r.id));
    const rawRecordings = [...ownRecordings, ...teamRecordings.filter(r => !ownIds.has(r.id))];

    // Payload liviano a propósito: esta vista es una lista, no el detalle —
    // el transcript completo (puede ser texto larguísimo) nunca se necesita
    // aquí, solo saber si ya existe.
    const recordings = rawRecordings.map(r => ({ ...r, hasTranscript: !!r.transcript, transcript: undefined }));

    // fetchCalendarMeetings ya normaliza start/end a ISO con 'Z'
    // (graphMeetings.ts) — Graph los manda sin offset y Date los
    // interpretaría como hora LOCAL del server si no se corrigiera ahí. Acá
    // solo hace falta convertir a milisegundos para comparar.
    const toUtcMs = (iso: string) => new Date(iso).getTime();

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
        start: m.start,
        end: m.end,
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
