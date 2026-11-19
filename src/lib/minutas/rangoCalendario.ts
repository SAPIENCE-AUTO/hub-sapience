// Qué parte del calendario de Outlook le pide el Notetaker a Microsoft (src/api/getMinutasOverview.ts). Sin servidor ni React, para poder probarlo
// (server/scripts/test-minutas-rango.ts).
//
// La lista y la primera carga del calendario usan la ventana de siempre: los últimos 7 días y las próximas 2 semanas. Pero el calendario deja ir a
// cualquier semana con las flechas, y fuera de esa ventana salía vacío aunque hubiera juntas (la semana del 2 al 8 de noviembre se veía sin nada el
// día 16). Por eso el calendario ahora pide la semana que se esté viendo, con un rango propio.

/** La ventana de siempre (lista y primera carga del calendario). */
export const DIAS_ATRAS = 7;
export const DIAS_ADELANTE = 14;
/** Tope de una consulta: el calendario pide una semana a la vez; esto solo evita que alguien pida años enteros de golpe a Microsoft. */
export const MAX_DIAS_POR_CONSULTA = 42;
/** Ni antes de 2020 ni a más de 2 años a futuro: una fecha fuera de eso es un error de quien pide, no una semana real. */
const PRIMER_DIA_VALIDO = Date.parse('2020-01-01T00:00:00Z');
const MAX_DIAS_A_FUTURO = 730;
const DIA_MS = 24 * 60 * 60 * 1000;

export const MOTIVO_RANGO_INVALIDO = 'Las fechas que pidió el calendario no son válidas. Recarga la página e inténtalo de nuevo.';

export type RangoDeConsulta =
  | { ok: true; desde: Date; hasta: Date; /** `false` = la ventana de siempre; `true` = el rango que pidió el calendario. */ personalizado: boolean }
  | { ok: false; motivo: string };

const sinValor = (v: unknown) => v === undefined || v === null || v === '';

function aFecha(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * El rango de calendario que hay que pedir a Microsoft. Sin `desde` ni `hasta`: la ventana de siempre, contada desde `ahora`. Con los dos (fechas ISO,
 * con zona): ese rango, siempre que `desde` sea antes que `hasta`, no pase de MAX_DIAS_POR_CONSULTA y caiga en fechas razonables. Con solo uno de los
 * dos, o con algo ilegible, es inválido (no se adivina: pedir otra cosa en silencio escondería el error).
 */
export function rangoDeConsulta(pedido: { desde?: unknown; hasta?: unknown } | null | undefined, ahora: Date): RangoDeConsulta {
  const ningunoPedido = sinValor(pedido?.desde) && sinValor(pedido?.hasta);
  if (ningunoPedido) {
    return { ok: true, desde: new Date(ahora.getTime() - DIAS_ATRAS * DIA_MS), hasta: new Date(ahora.getTime() + DIAS_ADELANTE * DIA_MS), personalizado: false };
  }
  const desde = aFecha(pedido?.desde);
  const hasta = aFecha(pedido?.hasta);
  const invalido = { ok: false, motivo: MOTIVO_RANGO_INVALIDO } as const;
  if (!desde || !hasta) return invalido;
  if (desde.getTime() >= hasta.getTime()) return invalido;
  if (hasta.getTime() - desde.getTime() > MAX_DIAS_POR_CONSULTA * DIA_MS) return invalido;
  if (desde.getTime() < PRIMER_DIA_VALIDO) return invalido;
  if (hasta.getTime() > ahora.getTime() + MAX_DIAS_A_FUTURO * DIA_MS) return invalido;
  return { ok: true, desde, hasta, personalizado: true };
}
