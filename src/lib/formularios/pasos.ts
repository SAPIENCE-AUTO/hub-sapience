import { ID_AVISO, seccionInicio } from './inicio';
import type { Pregunta, Seccion } from './tipos';

/**
 * Los dos pasos de ley que el Hub pone en TODO filtro (pedido de Sergio, 2026-11-06), cada uno en su pantalla:
 *  - el aviso de privacidad, siempre primero (después de la bienvenida), con el texto completo en la página y «He leído y acepto» / «No acepto»;
 *  - el acuerdo de confidencialidad, siempre al final (antes de enviar), con «Leí y acepto» / «No acepto». Sin firma dibujada: esa es del NDA por sesión (docs/nda.md).
 * Quien no acepta alguno de los dos termina ahí (como siempre con el aviso): los `hub_` cortan solos (motor.ts) y esa respuesta no pasa al tablero.
 *
 * No se guardan en el filtro: `conPasosDelHub` los agrega al leerlo para el participante y para calificar (así los tienen también los filtros ya creados y los que están en vivo,
 * y nadie en el editor puede quitarlos ni moverlos). El aviso es la pregunta fija `hub_aviso` de siempre: si el filtro ya la traía dentro de «Antes de empezar» se saca de ahí a su
 * propia pantalla (lo demás de esa sección sigue igual y las condiciones «solo si aceptó el aviso» siguen valiendo); si no la traía, se agrega.
 */
export const SECCION_AVISO = 'hub_aviso_paso';
export const SECCION_ACUERDO = 'hub_acuerdo_paso';
export const ID_ACUERDO = 'hub_acuerdo';

/** Lo que dice la hoja «Antes de empezar» para quien ya pasó por el aviso (pedido de Sergio, 2026-11-06). */
export const TEXTO_REPASO_AVISO = 'Volver a leer aviso de privacidad, donde encontrarás cómo cuidamos tus datos personales y las condiciones de participación.';

const preguntaAviso = (): Pregunta => seccionInicio().preguntas.find((p) => p.id === ID_AVISO)!;

const preguntaAcuerdo = (): Pregunta => ({
  id: ID_ACUERDO, tipo: 'unica', nombre: 'Acuerdo de confidencialidad', texto: 'Acuerdo de confidencialidad',
  opciones: [
    { id: 'acepto', label: 'Leí y acepto el acuerdo de confidencialidad' },
    { id: 'no_acepto', label: 'No acepto', termina: 'No aceptó el acuerdo de confidencialidad', cortar: true },
  ],
});

/** Qué paso de ley es una pantalla, por la sección a la que pertenece. */
export const pasoLegalDe = (seccionId: string): 'aviso' | 'acuerdo' | undefined =>
  seccionId === SECCION_AVISO ? 'aviso' : seccionId === SECCION_ACUERDO ? 'acuerdo' : undefined;

/** La definición con el aviso primero y el acuerdo al final. Si ya los trae (se aplicó antes) devuelve la misma. No cambia la que recibe. */
export function conPasosDelHub<T extends { secciones: Seccion[] }>(def: T): T {
  const tiene = (id: string) => def.secciones.some((s) => s.id === id);
  let secciones = def.secciones;
  if (!tiene(SECCION_AVISO)) {
    const hallada: { aviso?: Pregunta } = {};
    secciones = secciones.map((s) => {
      const p = s.preguntas.find((q) => q.id === ID_AVISO);
      if (!p) return s;
      hallada.aviso = p;
      return { ...s, preguntas: s.preguntas.filter((q) => q.id !== ID_AVISO) };
    });
    secciones = [{ id: SECCION_AVISO, titulo: 'Aviso de privacidad', preguntas: [hallada.aviso ?? preguntaAviso()] }, ...secciones];
  }
  if (!tiene(SECCION_ACUERDO)) secciones = [...secciones, { id: SECCION_ACUERDO, titulo: 'Acuerdo de confidencialidad', preguntas: [preguntaAcuerdo()] }];
  return secciones === def.secciones ? def : { ...def, secciones };
}
