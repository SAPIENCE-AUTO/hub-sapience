import type { Definicion, Pregunta, Seccion } from './tipos';

/**
 * «Antes de empezar»: con lo que arranca todo filtro (pedido de Sergio,
 * 2026-10-23). El aviso de privacidad (con el enlace para leerlo), el nombre
 * y la identificación oficial: quien no acepta el aviso o no quiere dar su
 * identificación termina ahí; sin la foto no puede seguir. La pone el Hub
 * (como las preguntas del NSE): la IA no la escribe y en el editor queda fija.
 *
 * El celular y el correo también van aquí por defecto (pedido de Sergio,
 * 2026-10-26), pero son preguntas normales: el analista las puede corregir o
 * quitar. Con nombre, celular y correo la búsqueda de duplicados (2 de 3) sirve.
 */
export const SECCION_INICIO = 'hub_inicio';
export const ID_AVISO = 'hub_aviso';
export const ID_NOMBRE = 'hub_nombre';
export const ID_ACEPTA_IDENTIFICACION = 'hub_id_acepta';
export const ID_FOTO_IDENTIFICACION = 'hub_id_foto';
// Sin «hub_»: no quedan fijas ni cortan el filtro.
export const ID_CELULAR = 'contacto_celular';
export const ID_CORREO = 'contacto_correo';

export const esDelInicio = (preguntaId: string) => preguntaId.startsWith('hub_');

/** `contacto`: qué datos de contacto se ponen (los que el filtro todavía no pide). */
export function seccionInicio(contacto: { celular?: boolean; correo?: boolean } = { celular: true, correo: true }): Seccion {
  const acepto = { pregunta: ID_AVISO, incluye: ['acepto'] };
  return {
    id: SECCION_INICIO,
    titulo: 'Antes de empezar',
    preguntas: [
      {
        id: ID_AVISO, tipo: 'unica', nombre: 'Aviso de privacidad', texto: 'Aviso de privacidad', enlaceAviso: true,
        ayuda: 'Te invitamos a revisar nuestro aviso de privacidad, donde encontrarás cómo cuidamos tus datos personales.',
        opciones: [
          { id: 'acepto', label: 'He leído y acepto el aviso de privacidad' },
          { id: 'no_acepto', label: 'No acepto', termina: 'No aceptó el aviso de privacidad', cortar: true },
        ],
      },
      { id: ID_NOMBRE, tipo: 'texto', nombre: 'Nombre', texto: 'Nombre', ayuda: 'Escribe tu nombre completo.', mostrarSi: acepto },
      ...(contacto.celular ? [{ id: ID_CELULAR, tipo: 'telefono', nombre: 'Celular', texto: 'Celular', ayuda: 'Para contactarte si quedas en el estudio.', mostrarSi: acepto } satisfies Pregunta] : []),
      ...(contacto.correo ? [{ id: ID_CORREO, tipo: 'correo', nombre: 'Correo', texto: 'Correo electrónico', mostrarSi: acepto } satisfies Pregunta] : []),
      {
        id: ID_ACEPTA_IDENTIFICACION, tipo: 'unica', nombre: 'Acepta dar identificación', texto: 'Identificación', mostrarSi: acepto,
        ayuda: 'Para llenar este cuestionario y poder participar necesitamos una foto de una identificación oficial vigente (INE, pasaporte, etc.). ¿Estás de acuerdo?',
        opciones: [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No', termina: 'No quiso dar su identificación', cortar: true }],
      },
      {
        id: ID_FOTO_IDENTIFICACION, tipo: 'foto', nombre: 'Identificación', texto: 'Sube una foto de tu identificación oficial',
        ayuda: 'Que se vean claramente tu nombre completo, tu edad y la ciudad donde vives. Puedes tapar datos sensibles como tu dirección completa y el folio.',
        mostrarSi: { todas: [acepto, { pregunta: ID_ACEPTA_IDENTIFICACION, incluye: ['si'] }] },
      },
    ],
  };
}

/** Lo que el filtro ya preguntaba y ahora pregunta «Antes de empezar» (de una plantilla o de un filtro anterior). */
const repetida = (p: Pregunta) => p.id === 'aviso' || p.id === 'nombre';

/**
 * El filtro con «Antes de empezar» al principio (si no lo tenía). Quita su
 * propio aviso y su nombre, que ahora van ahí, y el nombre para el panel pasa
 * a ser el de «Antes de empezar». El celular y el correo solo se agregan si el
 * filtro no los pide ya (una plantilla o un filtro anterior).
 */
export function conInicio(def: Definicion): Definicion {
  if (def.secciones.some((s) => s.id === SECCION_INICIO)) return def;
  const quitadas = new Set(def.secciones.flatMap((s) => s.preguntas).filter(repetida).map((p) => p.id));
  const titulo = seccionInicio().titulo!.toLowerCase();
  const secciones = def.secciones
    .map((s) => ({ ...s, preguntas: s.preguntas.filter((p) => !quitadas.has(p.id)) }))
    .filter((s) => s.preguntas.length > 0)
    // La que se llamaba igual (las indicaciones de una plantilla) cambia de nombre: dos «Antes de empezar» seguidas confunden.
    .map((s) => (s.titulo?.trim().toLowerCase() === titulo ? { ...s, titulo: 'Indicaciones' } : s));
  const nombre = def.claves?.nombre && !quitadas.has(def.claves.nombre) ? def.claves.nombre : ID_NOMBRE;
  const tiene = (tipo: Pregunta['tipo']) => secciones.some((s) => s.preguntas.some((p) => p.tipo === tipo));
  const contacto = { celular: !tiene('telefono'), correo: !tiene('correo') };
  return {
    ...def,
    secciones: [seccionInicio(contacto), ...secciones],
    claves: { ...def.claves, nombre, ...(contacto.celular ? { telefono: ID_CELULAR } : {}) },
  };
}

/** «Antes de empezar» siempre primero, aunque se reordene lo demás. */
export function inicioPrimero(secciones: Seccion[]): Seccion[] {
  const inicio = secciones.find((s) => s.id === SECCION_INICIO);
  return inicio ? [inicio, ...secciones.filter((s) => s !== inicio)] : secciones;
}
