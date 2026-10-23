import { TOPE_MINUTOS, duracionEstimada, duracionPorPerfil } from './duracion';
import { unirY } from './palabras';
import { sinNombreCorto } from './tabla';
import type { Definicion } from './tipos';

/**
 * «¿Está listo?»: lo que tiene que cumplir un filtro antes de que lo contesten
 * participantes reales. No bloquea nada (Prueba sirve justo para llegar
 * aquí); dice qué falta en palabras.
 */
export interface Chequeo { id: string; texto: string; ok: boolean; falta?: string }

export function chequeosListo(o: {
  def: Definicion;
  /** Cosas por corregir en el editor (sin ellas no se guarda). */
  problemas: number;
  /** Supuestos de la IA sin revisar; `undefined` si el filtro no se hizo con la IA. */
  supuestosPorRevisar?: number;
  respuestasDePrueba: number;
  vinculado: boolean;
}): Chequeo[] {
  const perfiles = o.def.frentes ?? [];
  const sinNombre = sinNombreCorto(o.def).length;
  const lentos = duracionPorPerfil(o.def).filter((p) => p.minutos > TOPE_MINUTOS);
  const { tipico } = duracionEstimada(o.def);
  const n = (k: number, una: string, varias: string) => `${k} ${k === 1 ? una : varias}`;
  return [
    { id: 'problemas', texto: 'Nada por corregir', ok: o.problemas === 0, falta: n(o.problemas, 'cosa por corregir', 'cosas por corregir') },
    {
      id: 'perfiles', texto: 'Perfiles con su cuota', ok: perfiles.length > 0 && perfiles.every((f) => f.meta > 0),
      falta: perfiles.length ? 'Hay un perfil sin cuota' : 'Sin perfiles nadie califica',
    },
    {
      id: 'tiempo', texto: `Cabe en ${TOPE_MINUTOS} minutos`, ok: !lentos.length && tipico <= TOPE_MINUTOS,
      falta: lentos.length ? `Se pasa${lentos.length === 1 ? '' : 'n'}: ${unirY(lentos.map((p) => `${p.nombre} (${p.minutos} min)`))}` : `Lo típico son ${tipico} min`,
    },
    { id: 'nombres', texto: 'Cada pregunta con nombre corto', ok: sinNombre === 0, falta: n(sinNombre, 'pregunta sin nombre', 'preguntas sin nombre') },
    ...(o.supuestosPorRevisar !== undefined
      ? [{ id: 'supuestos', texto: 'Supuestos de la IA revisados', ok: o.supuestosPorRevisar === 0, falta: 'Están arriba del documento' }]
      : []),
    { id: 'probado', texto: 'Contestado en prueba', ok: o.respuestasDePrueba > 0, falta: 'Contéstalo desde el enlace, en prueba' },
    { id: 'tablero', texto: 'Vinculado a un tablero de Reclutamiento', ok: o.vinculado, falta: 'Se elige en Respuestas' },
  ];
}
