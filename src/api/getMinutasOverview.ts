import { z } from 'zod';
import { createEndpoint, MeetingRecordings, Users, Projects } from '../../server/compat';
import { fetchCalendarMeetings } from '../serverUtils/graphMeetings';
import { guardarTranscripcionDeAssembly } from '../serverUtils/guardarTranscripcion';
import { accionDeRescate, attemptTranscriptionRecovery, reservaIntento } from '../serverUtils/transcriptionRecovery';

const RECORDING_FIELDS = [
  'graphEventId', 'subject', 'meetingStart', 'meetingEnd', 'status',
  'muxPlaybackId', 'muxAssetId', 'assemblyTranscriptId', 'transcript', 'project', 'deal', 'updatedAt', 'recallBotId',
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

    const { records: teamRecordings } = myProjectIds.length > 0
      ? await MeetingRecordings.findAll({
          filters: { project: { in: myProjectIds } as any },
          sorts: [{ field: 'createdAt', direction: 'desc' }],
          fields: [...RECORDING_FIELDS],
        })
      : { records: [] as typeof ownRecordings };

    const ownIds = new Set(ownRecordings.map(r => r.id));
    const rawRecordings = [...ownRecordings, ...teamRecordings.filter(r => !ownIds.has(r.id))];

    // "necesito que sea infalible" (Sergio, tras "Ajustes LRP" quedarse con video pero sin transcripción sin que nadie
    // se enterara): cada vez que alguien abre/refresca Minutas (esta vista hace polling cada 60 s mientras la página
    // está abierta), de paso revisa si alguna minuta quedó atorada y la rescata sola (accionDeRescate):
    //  - video listo y la transcripción nunca arrancó → la arranca (mismo mecanismo que el botón manual de
    //    retryMeetingTranscription.ts);
    //  - ya se mandó a AssemblyAI pero el texto nunca llegó (el aviso de AssemblyAI se perdió o nunca se configuró;
    //    pasó del 24 de sept. al 12 de oct.) → le pregunta directo y, si ya terminó, lo guarda.
    // Cubre las propias y las del equipo que se ven aquí: el rescate es idempotente y reservaIntento evita que varias
    // personas con la pantalla abierta repitan la consulta a cada rato.
    const ahora = Date.now();
    for (const r of rawRecordings) {
      const accion = accionDeRescate(r, ahora);
      if (!accion || !reservaIntento(r.id, ahora)) continue;
      const rescate = accion === 'iniciar'
        ? attemptTranscriptionRecovery({ id: r.id, muxPlaybackId: r.muxPlaybackId, muxAssetId: r.muxAssetId })
        : guardarTranscripcionDeAssembly({ id: r.id, recallBotId: r.recallBotId }, r.assemblyTranscriptId!);
      rescate.catch(err => console.error('[getMinutasOverview] rescate de transcripción falló', accion, r.id, (err as Error).message));
    }

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
