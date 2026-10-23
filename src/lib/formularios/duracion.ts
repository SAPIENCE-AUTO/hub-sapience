import { opcionesDe } from './tabla';
import { ubicar } from './palabras';
import type { Definicion, Pregunta, Seccion, TipoPregunta } from './tipos';

/**
 * Cuánto tarda alguien en contestar el screener en el celular, contra el
 * tope de 10 minutos de Sergio. Es una estimación: leer (unas 200 palabras
 * por minuto) más lo que toma contestar cada tipo.
 *
 * - Típico: lo que depende de una respuesta cuenta la mitad (a unos les
 *   sale y a otros no) y una sección que se repite sale 1.5 veces.
 * - Máximo: sale todo lo que depende de una respuesta y cada sección que se
 *   repite sale 3 veces (o las que permita, si son menos).
 * Calibrada con ALONG 2, que Sergio midió en unos 10 minutos.
 */

export const TOPE_MINUTOS = 10;
/** Leer: unas 200 palabras por minuto la pregunta y más rápido las opciones, que se recorren con la vista. */
const SEG_POR_PALABRA = 0.3;
const SEG_POR_PALABRA_OPCION = 0.15;

/** Segundos para contestar, sin contar la lectura. */
const CONTESTAR: Record<TipoPregunta, (p: Pregunta, opciones: number) => number> = {
  texto: () => 8,
  texto_largo: () => 25,
  numero: () => 4,
  telefono: () => 8,
  correo: () => 10,
  direccion: () => 35,
  unica: () => 2,
  multiple: (_, n) => 2 + n * 0.3,
  lista: () => 5,
  lista_multiple: (_, n) => 5 + Math.min(n, 30) * 0.2,
  imagen_unica: (_, n) => 2 + n * 0.5,
  imagen_multiple: (_, n) => 2 + n * 0.7,
  matriz: (p) => 2.5 * (p.filas?.length ?? 1),
  matriz_multiple: (p) => 3.5 * (p.filas?.length ?? 1),
  ordenar: (p, n) => 2 * Math.min(p.maxOpciones ?? n, n),
  escala: () => 3,
  estrellas: () => 2,
  deslizador: () => 3,
  casilla: () => 2,
  interruptor: () => 2,
  foto: () => 35,
  contenido: (p) => (p.imagen ? 8 : 0),
};

const palabras = (texto?: string) => (texto ? texto.trim().split(/\s+/).filter(Boolean).length : 0);

function segundosPregunta(def: Definicion, p: Pregunta): number {
  const opciones = opcionesDe(def, p);
  // De las opciones que salen de otra pregunta se ve, por lo general, la mitad (lo que marcó).
  const vistas = p.opcionesDe ? Math.ceil(opciones.length / 2) : opciones.length;
  const leer = (palabras(p.texto) + palabras(p.ayuda) + (p.filas ?? []).reduce((n, f) => n + palabras(f.label), 0)) * SEG_POR_PALABRA
    + opciones.slice(0, vistas).reduce((n, o) => n + palabras(o.label), 0) * SEG_POR_PALABRA_OPCION;
  return leer + (CONTESTAR[p.tipo]?.(p, vistas) ?? 5);
}

/** Cuántas veces sale una sección: 1, o sus repeticiones (típico 1.5, máximo 3, nunca más de las que permite). */
function veces(def: Definicion, s: Seccion, maximo: boolean): number {
  if (!s.repetirPor) return 1;
  const origen = ubicar(def, s.repetirPor)?.pregunta;
  const posibles = (origen ? opcionesDe(def, origen) : [])
    .filter((o) => !o.exclusiva && (!s.repetirSolo || s.repetirSolo.includes(o.id))).length;
  return Math.min(maximo ? 3 : 1.5, posibles);
}

function segundosSeccion(def: Definicion, s: Seccion, maximo: boolean): number {
  const peso = (condicional: boolean) => (condicional && !maximo ? 0.5 : 1);
  const una = (palabras(s.titulo) + palabras(s.intro)) * SEG_POR_PALABRA
    + s.preguntas.reduce((n, p) => n + segundosPregunta(def, p) * peso(!!p.mostrarSi), 0)
    + 3; // pasar de pantalla
  return una * veces(def, s, maximo) * peso(!!s.mostrarSi);
}

function segundos(def: Definicion, maximo: boolean): number {
  return def.secciones.reduce((n, s) => n + segundosSeccion(def, s, maximo), palabras(def.bienvenida) * SEG_POR_PALABRA);
}

export interface Duracion { tipico: number; maximo: number }

/** Minutos, redondeados hacia arriba. */
export function duracionEstimada(def: Definicion): Duracion {
  return { tipico: Math.ceil(segundos(def, false) / 60), maximo: Math.ceil(segundos(def, true) / 60) };
}

/** Minutos de cada sección, con un decimal (la estructura del generador los muestra junto a cada una). */
export function duracionPorSeccion(def: Definicion): Record<string, Duracion> {
  const min = (seg: number) => Math.round(seg / 6) / 10;
  return Object.fromEntries(def.secciones.map((s) => [s.id, { tipico: min(segundosSeccion(def, s, false)), maximo: min(segundosSeccion(def, s, true)) }]));
}
