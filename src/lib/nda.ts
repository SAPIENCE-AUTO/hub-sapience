// Lo que comparten la tabla de Reclutamiento y el detalle del NDA: los estados, sus colores del sistema del Hub (src/lib/toolColors.tsx: mismo color, mismo significado) y cómo se escriben las fechas.
import { EXITO, INFO, NEUTRAL, PELIGRO } from '@/lib/toolColors';

export type EstadoNda = 'enviado' | 'abierto' | 'firmado' | 'rechazado';

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
}

export const NDA_ETIQUETA: Record<EstadoNda, string> = { enviado: 'Enviado', abierto: 'Abrió', firmado: 'Firmado', rechazado: 'Rechazó' };
export const NDA_COLOR: Record<EstadoNda, string> = { enviado: NEUTRAL, abierto: INFO, firmado: EXITO, rechazado: PELIGRO };

/** Lo que se lee al pasar el cursor por la etiqueta: qué quiere decir cada estado. */
export const NDA_AYUDA: Record<EstadoNda, string> = {
  enviado: 'Se mandó el correo; todavía no abre la liga',
  abierto: 'Ya abrió la liga; falta que firme',
  firmado: 'Firmó el acuerdo',
  rechazado: 'No aceptó el acuerdo',
};

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
export const fechaDelEstado = (n: Pick<NdaDeFila, 'estado' | 'enviadoAt' | 'abiertoAt' | 'firmadoAt' | 'rechazadoAt'>) =>
  n.estado === 'firmado' ? n.firmadoAt : n.estado === 'rechazado' ? n.rechazadoAt : n.estado === 'abierto' ? n.abiertoAt : n.enviadoAt;
