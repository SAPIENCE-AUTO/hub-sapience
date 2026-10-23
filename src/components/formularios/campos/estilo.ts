import type { Opcion, Respuestas, Valor } from '@/lib/formularios/tipos';
import type { PreguntaVisible } from '@/lib/formularios/motor';

/**
 * Formulario del participante (/f/:codigo): neutros con un solo acento
 * oscuro, sin el teal ni el gold del Hub ni colores de marca. Opciones del
 * tamaño del pulgar.
 */
export const TINTA = '#1F1F23';
export const SUAVE = '#62626B';
export const BORDE = '#D9D9DE';
export const ERROR = '#C2272D';

export const inputClass = 'w-full rounded-xl border-[1.5px] border-[#D9D9DE] bg-white px-4 py-3 text-[16px] text-[#1F1F23] outline-none focus:border-[#1F1F23]';
export const etiquetaClass = 'mb-1 block text-[13px] font-medium text-[#62626B]';

export interface CampoProps {
  pv: PreguntaVisible;
  resp: Respuestas;
  /** Por clave: la respuesta va en `pv.clave` y el texto de «Otra» en `${pv.clave}#otra`. */
  onChange: (clave: string, valor: Valor | undefined) => void;
}

/** Marcar o desmarcar una opción de varias: «Ninguno» (exclusiva) deja solo esa; las demás la quitan. */
export function alternar(opciones: Opcion[], marcadas: string[], o: Opcion): string[] {
  if (marcadas.includes(o.id)) return marcadas.filter((x) => x !== o.id);
  if (o.exclusiva) return [o.id];
  const exclusivas = new Set(opciones.filter((x) => x.exclusiva).map((x) => x.id));
  return [...marcadas.filter((x) => !exclusivas.has(x)), o.id];
}
