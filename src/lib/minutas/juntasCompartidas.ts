// Juntas a las que una persona estaba invitada pero cuya grabación hizo OTRA (Sergio, 2026-11-26: «de calls previos no veo las transcripciones en el calendario»).
//
// El Notetaker guarda cada grabación a nombre de quien aprieta «Agregar Notetaker», y la lista de Minutas solo mostraba a cada quien las suyas y las de los
// proyectos donde es líder o analista. Lo que se pidió en septiembre era otra cosa: ver las juntas EN LAS QUE ESTUVO. Una junta en la que otra persona agregó
// el Notetaker se veía «Sin grabar» aunque la transcripción existiera.
//
// No se puede empatar por el id del evento de Outlook: cada persona invitada tiene SU propio id para la misma junta. Lo que sí es igual para todos es el
// asunto y el horario, así que una junta del calendario de la persona se empata con una grabación ajena cuando coinciden el asunto (sin acentos, sin
// mayúsculas y sin los «RV:» / «FW:» que Outlook agrega al reenviar una invitación), la hora de inicio y la de fin, con 10 minutos de tolerancia. Solo se empata
// con juntas que ya están en el calendario de esa persona: una grabación de una junta a la que no fue invitada nunca aparece, ni siquiera como «sesión suelta».
//
// Lógica pura (sin base ni red) para poder probarla sola.

/** Cuánto pueden diferir la hora de inicio y la de fin entre el calendario de la persona y la grabación. */
export const TOLERANCIA_HORARIO_MS = 10 * 60 * 1000;

export interface JuntaDelCalendario {
  /** Id del evento en el calendario de la persona. */
  id: string;
  subject: string;
  start: string;
  end: string;
}

export interface GrabacionAjena {
  id: string;
  subject?: string | null;
  meetingStart?: string | Date | null;
  meetingEnd?: string | Date | null;
  hasTranscript?: boolean;
  status?: string | null;
}

/**
 * El asunto como se compara: sin acentos ni mayúsculas, con los espacios en uno solo y sin los prefijos de respuesta o reenvío (uno o varios, en español o en
 * inglés). Con los acentos quitados la ñ queda como n: aquí solo sirve para decidir si dos asuntos son el mismo, no para buscar texto.
 */
export function normalizarAsunto(asunto: string | null | undefined): string {
  let s = (asunto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (;;) {
    const sinPrefijo = s.replace(/^(re|rv|fw|fwd|reenviado|forwarded)\s*:\s*/, '');
    if (sinPrefijo === s) break;
    s = sinPrefijo;
  }
  return s;
}

const aMs = (v: string | Date | null | undefined): number => (v ? new Date(v).getTime() : NaN);

/**
 * ¿La grabación es de esta junta del calendario? Mismo asunto y misma hora de inicio; la de fin también cuando se sabe en los dos lados (distingue dos juntas
 * con el mismo nombre que empiezan juntas pero duran distinto). Un asunto vacío o «Sin título» no dice nada de la junta: nunca empata.
 */
export function esLaMismaJunta(junta: JuntaDelCalendario, grabacion: GrabacionAjena): boolean {
  const asunto = normalizarAsunto(junta.subject);
  if (!asunto || asunto === 'sin titulo' || asunto !== normalizarAsunto(grabacion.subject)) return false;

  const inicioGrabacion = aMs(grabacion.meetingStart);
  const inicioJunta = aMs(junta.start);
  if (Number.isNaN(inicioGrabacion) || Number.isNaN(inicioJunta) || Math.abs(inicioGrabacion - inicioJunta) > TOLERANCIA_HORARIO_MS) return false;

  const finGrabacion = aMs(grabacion.meetingEnd);
  const finJunta = aMs(junta.end);
  if (!Number.isNaN(finGrabacion) && !Number.isNaN(finJunta) && Math.abs(finGrabacion - finJunta) > TOLERANCIA_HORARIO_MS) return false;

  return true;
}

/**
 * A cada junta del calendario le asigna, si hay, la grabación ajena que le toca (por el id de la junta). Una grabación sirve para una sola junta. Si varias
 * personas grabaron la misma junta, gana la que tiene transcripción, luego la que ya terminó de procesarse y luego la de hora de inicio más cercana (y, para que
 * el resultado no dependa del orden en que llegan, el id más chico).
 */
export function empatarGrabacionesAjenas<G extends GrabacionAjena>(juntas: JuntaDelCalendario[], grabaciones: G[]): Map<string, G> {
  const resultado = new Map<string, G>();
  const usadas = new Set<string>();
  for (const junta of juntas) {
    const inicioJunta = aMs(junta.start);
    const candidatas = grabaciones
      .filter((g) => !usadas.has(g.id) && esLaMismaJunta(junta, g))
      .sort((a, b) =>
        Number(!!b.hasTranscript) - Number(!!a.hasTranscript)
        || Number(b.status === 'ready') - Number(a.status === 'ready')
        || Math.abs(aMs(a.meetingStart) - inicioJunta) - Math.abs(aMs(b.meetingStart) - inicioJunta)
        || a.id.localeCompare(b.id));
    if (candidatas.length === 0) continue;
    resultado.set(junta.id, candidatas[0]);
    usadas.add(candidatas[0].id);
  }
  return resultado;
}
