import { SECCION_INICIO } from './inicio';
import type { Definicion, Pregunta, Seccion } from './tipos';

/**
 * Preguntas que van en todos los filtros (pedido de Sergio, 2026-10-26, con
 * las de ALONG 2 como modelo): al inicio, si tiene hijos, cuántos, de qué
 * género y edad, y si van a escuela pública o privada; después del NSE, los
 * ingresos del hogar, los modelos y años de sus autos y su último viaje.
 *
 * Las pone el Hub, como el celular y el correo de «Antes de empezar», pero son
 * preguntas normales: el analista las corrige o las quita. Si el filtro ya
 * pregunta algo de eso (la IA, una plantilla o un filtro anterior), esa parte
 * no se agrega.
 */
export const ID_HIJOS = 'familia_hijos';
export const ID_HIJOS_CUANTOS = 'familia_hijos_cuantos';
export const ID_HIJOS_EDADES = 'familia_hijos_edades';
export const ID_HIJOS_ESCUELA = 'familia_hijos_escuela';
export const ID_INGRESOS = 'hogar_ingresos';
export const ID_AUTOS = 'hogar_autos';
export const ID_VIAJE = 'hogar_viaje';

const tieneHijos = { pregunta: ID_HIJOS, incluye: ['si'] };

export function preguntasDeHijos(): Pregunta[] {
  return [
    { id: ID_HIJOS, tipo: 'unica', nombre: 'Hijos', texto: '¿Tienes hijos?', opciones: [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No' }] },
    { id: ID_HIJOS_CUANTOS, tipo: 'numero', nombre: 'Número de hijos', texto: '¿Cuántos hijos tienes?', min: 1, max: 15, mostrarSi: tieneHijos },
    {
      id: ID_HIJOS_EDADES, tipo: 'texto', nombre: 'Género y edad de hijos', texto: 'Por favor dinos el género y la edad de cada uno de tus hijos',
      ayuda: 'Por ejemplo: niña de 8 años, niño de 5 años.', mostrarSi: tieneHijos,
    },
    {
      id: ID_HIJOS_ESCUELA, tipo: 'unica', nombre: 'Escuela de hijos', texto: '¿Tus hijos van a escuela pública o privada?', mostrarSi: tieneHijos,
      opciones: [
        { id: 'publica', label: 'Pública' }, { id: 'privada', label: 'Privada' },
        { id: 'ambas', label: 'Unos en pública y otros en privada' }, { id: 'no_van', label: 'No van a la escuela' },
      ],
    },
  ];
}

/** Las que van después del NSE. Los ingresos, en pesos: solo en México. El modelo de los autos, solo si tiene alguno. */
export function preguntasDelHogar(def: Pick<Definicion, 'pais' | 'secciones'>): Pregunta[] {
  const conAutos = def.secciones.some((s) => s.preguntas.some((p) => p.id === 'nse_autos'));
  return [
    ...(def.pais === 'MX' ? [{
      id: ID_INGRESOS, tipo: 'unica', nombre: 'Ingresos del hogar', texto: 'Aproximadamente, ¿cuál es el ingreso mensual de tu hogar?',
      opciones: [
        { id: 'menos_8k', label: 'Menos de MX $8,000' }, { id: '8k_15k', label: 'Entre MX $8,000 y $15,000' },
        { id: '16k_30k', label: 'Entre MX $16,000 y $30,000' }, { id: '31k_49k', label: 'Entre MX $31,000 y $49,000' },
        { id: '50k_80k', label: 'Entre MX $50,000 y $80,000' }, { id: '81k_120k', label: 'Entre MX $81,000 y $120,000' },
        { id: 'mas_120k', label: 'Más de MX $120,000' },
      ],
    } satisfies Pregunta] : []),
    {
      id: ID_AUTOS, tipo: 'texto_largo', nombre: 'Modelos de autos', texto: 'Escribe qué modelos y años de autos tienen en tu hogar',
      ...(conAutos ? { mostrarSi: { pregunta: 'nse_autos', noIncluye: ['0'] } } : {}),
    },
    { id: ID_VIAJE, tipo: 'texto_largo', nombre: 'Último viaje', texto: '¿Cuándo fue el último viaje de placer que realizaste y a dónde?' },
  ];
}

// Lo que el filtro ya pregunta, por sus palabras (las del NSE no cuentan: «¿Cuántos autos…?» no es «qué modelos»).
const YA_PREGUNTA: Record<string, RegExp> = {
  hijos: /\bhij[oa]s?\b/i,
  [ID_INGRESOS]: /\bingresos?\b/i,
  [ID_AUTOS]: /\bmodelos?\b.*\b(autos?|coches?|carros?|camionetas?)\b|\b(autos?|coches?|carros?|camionetas?)\b.*\bmodelos?\b/i,
  [ID_VIAJE]: /\bviajes?\b|\bviajaste\b/i,
};

/**
 * El filtro con las preguntas de siempre. Las de hijos van al final de la
 * primera sección después de «Antes de empezar» («Sobre ti»); las del hogar,
 * justo después de la última pregunta del NSE. Si el filtro todavía no tiene
 * esas secciones (uno con IA antes de escribirse), no se pone nada: el
 * generador lo vuelve a pedir antes de armar la lógica.
 */
export function conEstandar(def: Definicion): Definicion {
  const todas = def.secciones.flatMap((s) => s.preguntas);
  const ids = new Set(todas.map((p) => p.id));
  const delNse = (p: Pregunta) => !!def.nse?.puntos[p.id] || p.id.startsWith('nse_');
  const yaPregunta = (clave: string) => todas.some((p) => !delNse(p) && (YA_PREGUNTA[clave].test(p.texto) || YA_PREGUNTA[clave].test(p.nombre ?? '')));

  let secciones = def.secciones;
  // Ni una sección que se repite o que sale solo a veces, ni una de puras indicaciones.
  const primera = secciones.findIndex((s) => s.id !== SECCION_INICIO && !s.repetirPor && !s.mostrarSi
    && s.preguntas.some((p) => p.tipo !== 'contenido') && !s.preguntas.some(delNse));
  if (primera >= 0 && !ids.has(ID_HIJOS) && !yaPregunta('hijos')) {
    secciones = secciones.map((s, i) => (i === primera ? { ...s, preguntas: [...s.preguntas, ...preguntasDeHijos()] } : s));
  }
  const nse = secciones.findIndex((s) => s.preguntas.some(delNse));
  if (nse >= 0) {
    const faltan = preguntasDelHogar(def).filter((p) => !ids.has(p.id) && !yaPregunta(p.id));
    if (faltan.length) {
      secciones = secciones.map((s, i) => {
        if (i !== nse) return s;
        const despues = s.preguntas.length - [...s.preguntas].reverse().findIndex(delNse);
        return { ...s, preguntas: [...s.preguntas.slice(0, despues), ...faltan, ...s.preguntas.slice(despues)] } satisfies Seccion;
      });
    }
  }
  return secciones === def.secciones ? def : { ...def, secciones };
}
