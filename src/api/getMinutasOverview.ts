import { z } from 'zod';
import { createEndpoint, pool, MeetingRecordings, Users, Projects, ZiteError } from '../../server/compat';
import { fetchCalendarMeetings, type CalendarMeeting } from '../serverUtils/graphMeetings';
import { rangoDeConsulta } from '../lib/minutas/rangoCalendario';
import { empatarGrabacionesAjenas, type GrabacionAjena } from '../lib/minutas/juntasCompartidas';
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

// Grabaciones de OTRAS personas de juntas cercanas al rango del calendario (Sergio, 2026-11-26: «de calls previos no veo las transcripciones»). Sirven SOLO para
// empatarlas con las juntas del calendario de este usuario (lib/minutas/juntasCompartidas.ts: mismo asunto y horario): las que no calzan con ninguna junta suya no
// salen en ningún lado, salvo las que ya se veían por ser de sus proyectos (esas siguen saliendo como sesión suelta). Se piden en liviano: sin el texto de la
// transcripción, solo si lo hay.
interface GrabacionAjenaFila extends GrabacionAjena {
  muxPlaybackId?: string;
  assemblyTranscriptId?: string;
  project?: string[];
  deal?: string[];
}
async function grabacionesAjenasEnRango(email: string, desde: Date, hasta: Date): Promise<GrabacionAjenaFila[]> {
  const MARGEN_MS = 12 * 60 * 60 * 1000; // el calendario y la grabación pueden diferir unos minutos; el margen cubre cualquier cruce de día
  const { rows } = await pool.query(
    `select id::text as id, subject, meeting_start, meeting_end, status, mux_playback_id, assembly_transcript_id,
            project_id::text as project_id, deal_id::text as deal_id,
            (transcript is not null and btrim(transcript) <> '') as has_transcript
       from meeting_recordings
      where meeting_start >= $1 and meeting_start <= $2 and lower(coalesce(owner_email, '')) <> lower($3)
      order by meeting_start
      limit 500`,
    [new Date(desde.getTime() - MARGEN_MS), new Date(hasta.getTime() + MARGEN_MS), email],
  );
  return rows
    .map((r: any): GrabacionAjenaFila => ({
      id: r.id,
      subject: r.subject,
      meetingStart: r.meeting_start,
      meetingEnd: r.meeting_end,
      status: r.status ?? undefined,
      muxPlaybackId: r.mux_playback_id ?? undefined,
      assemblyTranscriptId: r.assembly_transcript_id ?? undefined,
      hasTranscript: !!r.has_transcript,
      project: r.project_id ? [r.project_id] : undefined,
      deal: r.deal_id ? [r.deal_id] : undefined,
    }));
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

// Minutas / notetaker (sep 2026): "apartado de minutas donde vengan todas
// las sesiones (pasadas, ongoing y futuras)... si ya está vinculada... o
// vincular ahí mismo" (Sergio) — fusiona el calendario real (Graph) con las
// filas de meeting_recordings propias y las de proyectos donde el usuario es
// líder/analista, para que todo viva en un solo lugar. Correlaciona por
// graphEventId cuando existe (filas nuevas); las filas viejas o subidas a
// mano, sin ese campo, se muestran como sesiones propias sin intentar
// adivinar a qué evento de calendario pertenecen — es mejor mostrarlas de
// más que perderlas.
//
// Qué parte del calendario se pide (lib/minutas/rangoCalendario.ts): sin `desde`/`hasta`, la ventana de siempre (últimos 7 días y próximas 2
// semanas: la lista y la primera carga del calendario); con ellos, ese rango (el calendario pide la semana que se esté viendo, porque con las flechas se
// puede ir a cualquier semana y fuera de la ventana salía vacío aunque hubiera juntas). Las grabaciones no dependen del rango: siempre vienen todas
// las propias y las de los proyectos del usuario.
//
// Además (2026-11-26), una junta de SU calendario que sigue «Sin grabar» se muestra con la grabación que haya hecho otra persona de esa misma junta (mismo asunto y
// horario): estaba invitado, así que es suya aunque no haya apretado «Agregar Notetaker» (ver lib/minutas/juntasCompartidas.ts). Una grabación ajena de una junta
// a la que no fue invitado no sale.
export default createEndpoint({
  authenticated: true,
  description: 'Vista unificada de minutas: calendario (pasado/hoy/futuro) + grabaciones propias, con su estado de vínculo',
  inputSchema: z.object({
    /** Inicio del rango de calendario (fecha ISO con zona). Sin él ni `hasta`: la ventana de siempre. */
    desde: z.string().optional(),
    /** Fin del rango de calendario (fecha ISO con zona). */
    hasta: z.string().optional(),
  }),
  outputSchema: z.object({
    sessions: z.array(sessionSchema),
    /** `false`: no se pudo leer el calendario de Outlook (por ejemplo, una falla de Microsoft); solo vienen las juntas con grabación. */
    calendarioDisponible: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const email = context.user!.email;
    const now = new Date();
    const rango = rangoDeConsulta(input, now);
    if (rango.ok === false) throw new ZiteError({ code: 'BAD_REQUEST', message: rango.motivo }); // (=== false: sin el modo estricto, `!rango.ok` no estrecha el tipo)
    const rangeStart = rango.desde;
    const rangeEnd = rango.hasta;

    // Antes un fallo de Microsoft se tragaba en silencio y el calendario salía vacío sin explicación; ahora se avisa en la pantalla.
    let calendarioDisponible = true;
    const [calendarMeetings, { records: ownRecordings }, myProjectIds] = await Promise.all([
      fetchCalendarMeetings(email, rangeStart, rangeEnd).catch((err) => {
        calendarioDisponible = false;
        console.error('[getMinutasOverview] no se pudo leer el calendario de Outlook:', String((err as Error)?.message ?? err).slice(0, 80));
        return [] as CalendarMeeting[];
      }),
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

    // Juntas del calendario que siguen «Sin grabar»: si otra persona (a quien le tocó agregar el Notetaker) las grabó, también son del usuario, porque estaba
    // invitado: la grabación se guarda a nombre de quien aprieta el botón y el id del evento de Outlook es distinto en el calendario de cada invitado, así que no
    // se pueden empatar por id, sino por asunto y horario (lib/minutas/juntasCompartidas.ts). Una grabación ajena que no calza con ninguna junta del usuario no sale
    // (salvo que ya se viera por ser de uno de sus proyectos: entonces sigue saliendo como sesión suelta, igual que antes). Si la grabación ajena SÍ calza y ya se
    // veía por su proyecto, se pega a la junta en vez de salir aparte, para no verla dos veces.
    const compartidas = new Map<string, z.infer<typeof recordingSummarySchema>>(); // clave de la sesión → grabación de otra persona que le toca
    const sinGrabar = sessions.filter(s => !s.recording);
    if (sinGrabar.length > 0) {
      const ajenas = await grabacionesAjenasEnRango(email, rangeStart, rangeEnd)
        .catch((err) => {
          console.error('[getMinutasOverview] no se pudieron buscar grabaciones de otras personas:', String((err as Error)?.message ?? err).slice(0, 80));
          return [] as GrabacionAjenaFila[];
        });
      const empates = empatarGrabacionesAjenas(sinGrabar.map(s => ({ id: s.key, subject: s.subject, start: s.start, end: s.end })), ajenas);
      for (const s of sinGrabar) {
        const g = empates.get(s.key) as GrabacionAjenaFila | undefined;
        if (g) {
          usedRecordingIds.add(g.id);
          compartidas.set(s.key, {
            id: g.id,
            status: g.status ?? undefined,
            muxPlaybackId: g.muxPlaybackId,
            assemblyTranscriptId: g.assemblyTranscriptId,
            hasTranscript: !!g.hasTranscript,
            project: g.project,
            deal: g.deal,
          });
        }
      }
    }

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

    const all = [...sessions.map(s => (compartidas.has(s.key) ? { ...s, recording: compartidas.get(s.key) } : s)), ...standalone].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    return { sessions: all, calendarioDisponible };
  },
});
