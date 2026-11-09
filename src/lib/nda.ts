// Lo que comparten la tabla de Reclutamiento y el detalle del NDA: los estados, sus colores del sistema del Hub (src/lib/toolColors.tsx: mismo color, mismo significado) y cómo se escriben las fechas.
import { ALERTA, EXITO, INFO, NEUTRAL, PELIGRO } from '@/lib/toolColors';

export type EstadoNda = 'enviado' | 'abierto' | 'firmado' | 'rechazado';
/** Lo que se pinta: los cuatro estados y «No llegó» (el último correo rebotó y la persona todavía no abre la liga). */
export type EstadoVisible = EstadoNda | 'no_llego';

/** Un correo del NDA que el servidor de la persona devolvió: cuándo llegó el aviso y por qué, en palabras (guía: docs/nda.md → «Si el correo no llega»). */
export interface ReboteNda { at: string; motivo: string; codigo?: string }

/** El último envío de una fila, como lo devuelve getNDAStatuses. */
export interface NdaDeFila {
  rowId: string;
  envioId: string;
  estado: EstadoNda;
  enviadoAt?: string;
  abiertoAt?: string;
  firmadoAt?: string;
  rechazadoAt?: string;
  tienePdf: boolean;
  /** La sesión con que se mandó (para llenar de nuevo el diálogo de reenvío). */
  sesionAt?: string;
  sesionLugar?: string;
  /** Solo en «enviado»: el último correo rebotó y la persona todavía no abre la liga. */
  rebote?: ReboteNda;
}

export const NDA_ETIQUETA: Record<EstadoVisible, string> = { enviado: 'Enviado', abierto: 'Abrió', firmado: 'Firmado', rechazado: 'Rechazó', no_llego: 'No llegó' };
export const NDA_COLOR: Record<EstadoVisible, string> = { enviado: NEUTRAL, abierto: INFO, firmado: EXITO, rechazado: PELIGRO, no_llego: ALERTA };

/** Lo que se lee al pasar el cursor por la etiqueta: qué quiere decir cada estado. */
export const NDA_AYUDA: Record<EstadoVisible, string> = {
  enviado: 'Se mandó el correo; todavía no abre la liga',
  abierto: 'Ya abrió la liga; falta que firme',
  firmado: 'Firmó el acuerdo',
  rechazado: 'No aceptó el acuerdo',
  no_llego: 'El correo rebotó y no le llegó',
};

/** «No llegó» solo mientras la persona no haya abierto la liga (por WhatsApp, por ejemplo): si ya abrió, firmó o rechazó, el correo ya no importa. */
export const estadoVisible = (n: { estado: EstadoNda; rebote?: ReboteNda }): EstadoVisible => (n.estado === 'enviado' && n.rebote ? 'no_llego' : n.estado);

/** Lo que se lee al pasar el cursor: qué quiere decir el estado y, si el correo rebotó, por qué. */
export const ayudaDe = (n: { estado: EstadoNda; rebote?: ReboteNda }): string =>
  estadoVisible(n) === 'no_llego' ? `El correo rebotó: ${n.rebote!.motivo.charAt(0).toLowerCase()}${n.rebote!.motivo.slice(1)}` : NDA_AYUDA[n.estado];

const formato = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** «4 nov 2026, 10:42» en hora de la Ciudad de México. */
export const fechaMx = (iso?: string | null) => (iso ? formato.format(new Date(iso)) : '');

const formatoLocal = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Un instante → «AAAA-MM-DDTHH:mm» en hora de la Ciudad de México, que es lo que lleva un campo de fecha y hora. Vacío si no hay hora (solo fecha) o no es una fecha. */
export function aHoraMxLocal(iso?: string | null): string {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatoLocal.format(d).replace(' ', 'T');
}

/**
 * Qué sesión viene escrita en el diálogo de «NDA»: al reenviar, la que ya tenía el envío; si no, el evento del calendario al que está ligado el grupo de la persona
 * (`linkedCalEvent.eventId` en las opciones de la columna del grupo, con su fecha y lugar en `eventos`); si no hay, la del envío anterior; si no, vacía y se escribe a mano.
 */
export function sesionInicial(
  modo: 'primero' | 'reenviar' | 'nuevo',
  previo: Pick<NdaDeFila, 'sesionAt' | 'sesionLugar'> | undefined,
  opcionesDelGrupo: string | null | undefined,
  eventos: Record<string, { eventDate?: string; location?: string }>,
): { fecha: string; lugar: string } {
  const delPrevio = previo?.sesionAt ? { fecha: aHoraMxLocal(previo.sesionAt), lugar: previo.sesionLugar ?? '' } : undefined;
  if (modo === 'reenviar' && delPrevio) return delPrevio;
  let evento: { eventDate?: string; location?: string } | undefined;
  try {
    const id = JSON.parse(opcionesDelGrupo ?? '{}')?.linkedCalEvent?.eventId;
    evento = id ? eventos[id] : undefined;
  } catch { /* opciones ilegibles: sin evento */ }
  const fecha = aHoraMxLocal(evento?.eventDate);
  if (fecha) return { fecha, lugar: evento?.location ?? '' };
  return delPrevio ?? { fecha: '', lugar: '' };
}

/** La fecha más reciente del envío (la del último paso que dio la persona). */
export const fechaDelEstado = (n: Pick<NdaDeFila, 'estado' | 'enviadoAt' | 'abiertoAt' | 'firmadoAt' | 'rechazadoAt' | 'rebote'>) =>
  n.estado === 'firmado' ? n.firmadoAt : n.estado === 'rechazado' ? n.rechazadoAt : n.estado === 'abierto' ? n.abiertoAt : n.rebote ? n.rebote.at : n.enviadoAt;

// ── Mandar el NDA a varias personas a la vez (por grupo o por selección) ──────────────────────────────

export type MotivoDeLote = 'sin-correo' | 'firmado' | 'rechazado' | 'pendiente' | 'marcado';

/**
 * Qué pasa con cada persona al mandar el NDA en lote: si se puede marcar y si viene marcada de entrada.
 * - Sin correo, ya firmó o rechazó: no se puede marcar (para mandarle otro, desde el detalle de su fila: es una decisión que se toma de una en una).
 * - Ya tiene un envío sin firmar (Enviado o Abrió): se puede marcar, pero viene sin marcar; si se marca, el servidor le reenvía el mismo correo con la misma liga.
 * - Marcada a mano como enviada antes del flujo con liga: igual, sin marcar de entrada.
 * - Sin nada: viene marcada.
 */
export function clasificarParaLote(
  persona: { correo?: string | null; ndaSent?: boolean | null },
  nda?: Pick<NdaDeFila, 'estado'>,
): { puede: boolean; marcada: boolean; motivo?: MotivoDeLote } {
  if (!(persona.correo ?? '').trim()) return { puede: false, marcada: false, motivo: 'sin-correo' };
  if (nda?.estado === 'firmado') return { puede: false, marcada: false, motivo: 'firmado' };
  if (nda?.estado === 'rechazado') return { puede: false, marcada: false, motivo: 'rechazado' };
  if (nda) return { puede: true, marcada: false, motivo: 'pendiente' };
  if (persona.ndaSent) return { puede: true, marcada: false, motivo: 'marcado' };
  return { puede: true, marcada: true };
}

export interface ResultadoDeLote { id: string; ok: boolean; mensaje: string; omitido?: boolean }

/**
 * Manda de una en una, en orden y esperando a que termine cada una (así Outlook no recibe una avalancha y el avance es real). Si una falla, sigue con las demás;
 * si se pide `detener`, las que faltan no se mandan y quedan anotadas como omitidas. Siempre devuelve un resultado por persona, en el mismo orden.
 */
export async function enviarEnLote(
  ids: string[],
  enviarUno: (id: string) => Promise<{ success: boolean; message: string }>,
  opciones: { alAvanzar?: (hechos: number, total: number) => void; detener?: () => boolean } = {},
): Promise<ResultadoDeLote[]> {
  const resultados: ResultadoDeLote[] = [];
  for (const id of ids) {
    if (opciones.detener?.()) {
      resultados.push({ id, ok: false, omitido: true, mensaje: 'No se mandó: se detuvo el envío.' });
      continue;
    }
    try {
      const r = await enviarUno(id);
      resultados.push({ id, ok: !!r.success, mensaje: r.message });
    } catch {
      resultados.push({ id, ok: false, mensaje: 'No se pudo enviar. Inténtalo de nuevo.' });
    }
    opciones.alAvanzar?.(resultados.length, ids.length);
  }
  return resultados;
}
