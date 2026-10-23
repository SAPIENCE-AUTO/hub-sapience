import { opcionesDe } from './tabla';
import { ubicar } from './palabras';
import { forma, type Condicion, type Definicion, type Frente, type Pregunta, type Seccion, type TipoPregunta } from './tipos';

/**
 * Cuánto tarda alguien en contestar el screener en el celular, contra el
 * tope de 10 minutos de Sergio. Es una estimación: leer (unas 200 palabras
 * por minuto) más lo que toma contestar cada tipo.
 *
 * - Típico: lo que depende de una respuesta cuenta la mitad (a unos les
 *   sale y a otros no) y una sección que se repite sale 1.5 veces.
 * - Máximo: sale todo lo que depende de una respuesta y cada sección que se
 *   repite sale 3 veces (o las que permita, si son menos).
 * - Por perfil: lo típico de quien entra a ese perfil — lo que el perfil pide
 *   (sus bloques, su edad…) sale seguro y lo que choca con eso no sale.
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

// ── por perfil ───────────────────────────────────────────────────────────────
/** Lo que contesta seguro quien entra a un perfil: clave de respuesta (id o id@opción) → lo que marca o el número. */
type Pide = Map<string, Set<string> | number>;
const claveDe = (id: string, instancia?: string) => (instancia ? `${id}@${instancia}` : id);

function marcar(pide: Pide, clave: string, opcion: string) {
  const ya = pide.get(clave);
  if (ya instanceof Set) ya.add(opcion); else pide.set(clave, new Set([opcion]));
}

/** Lo mínimo que tiene que contestar para cumplir la condición (en «alguna», el primer camino). */
function anotar(def: Definicion, c: Condicion, pide: Pide, instancia?: string) {
  if ('todas' in c) c.todas.forEach((x) => anotar(def, x, pide, instancia));
  else if ('alguna' in c) { if (c.alguna[0]) anotar(def, c.alguna[0], pide, instancia); }
  else if ('bloque' in c) {
    const s = def.secciones.find((x) => x.id === c.bloque);
    if (s?.repetirPor) marcar(pide, s.repetirPor, c.opcion);
  } else if ('numero' in c) pide.set(claveDe(c.numero, c.instancia ?? instancia), (c.entre[0] + c.entre[1]) / 2);
  else if ('pregunta' in c && 'incluye' in c && c.incluye[0]) marcar(pide, claveDe(c.pregunta, c.instancia ?? instancia), c.incluye[0]);
  else if ('pregunta' in c && 'incluyeTodas' in c) c.incluyeTodas.forEach((o) => marcar(pide, claveDe(c.pregunta, c.instancia ?? instancia), o));
  // «no», «noIncluye», NSE e «instanciaEs» no obligan a contestar nada.
}

/** Lo que pide el perfil y, para llegar a esas preguntas, lo que hace que aparezcan (su sección, su «solo si»). */
function loQuePide(def: Definicion, f: Frente): Pide {
  const pide: Pide = new Map();
  anotar(def, f.califica, pide);
  const vistas = new Set<string>();
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const clave of [...pide.keys()]) {
      const [id, instancia] = clave.split('@');
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      cambio = true;
      const u = ubicar(def, id);
      if (u?.seccion.mostrarSi) anotar(def, u.seccion.mostrarSi, pide);
      if (u?.pregunta.mostrarSi) anotar(def, u.pregunta.mostrarSi, pide, instancia);
      // Los bloques que pide salen de lo marcado aquí: también cuenta lo que hace aparecer esos bloques.
      for (const s of def.secciones) if (s.repetirPor === id && s.mostrarSi) anotar(def, s.mostrarSi, pide);
    }
  }
  return pide;
}

/**
 * Si sale, con lo que se sabe de quien entra al perfil: 1 sí, 0 no, 0.5 no se
 * sabe (depende de algo que el perfil no pide). En las de varias, que marque
 * una no dice nada de las demás; en las de una sola, sí.
 */
function sale(def: Definicion, c: Condicion, pide: Pide, instancia?: string): number {
  if ('todas' in c) return Math.min(1, ...c.todas.map((x) => sale(def, x, pide, instancia)));
  if ('alguna' in c) return Math.max(0, ...c.alguna.map((x) => sale(def, x, pide, instancia)));
  if ('no' in c) return 1 - sale(def, c.no, pide, instancia);
  if ('instanciaEs' in c) return instancia ? (c.instanciaEs.includes(instancia) ? 1 : 0) : 0.5;
  if ('nse' in c) return 0.5;
  if ('numero' in c) {
    const v = pide.get(claveDe(c.numero, c.instancia ?? instancia));
    return typeof v === 'number' ? (v >= c.entre[0] && v <= c.entre[1] ? 1 : 0) : 0.5;
  }
  if ('bloque' in c) {
    const s = def.secciones.find((x) => x.id === c.bloque);
    const marcadas = s?.repetirPor ? pide.get(s.repetirPor) : undefined;
    return marcadas instanceof Set && marcadas.has(c.opcion) ? 1 : 0.5;
  }
  const marcadas = pide.get(claveDe(c.pregunta, c.instancia ?? instancia));
  if (!(marcadas instanceof Set)) return 0.5;
  const p = ubicar(def, c.pregunta)?.pregunta;
  const unaSola = !!p && forma(p.tipo) !== 'varias';
  const tiene = (ids: string[]) => ids.some((x) => marcadas.has(x));
  if ('incluye' in c) return tiene(c.incluye) ? 1 : unaSola ? 0 : 0.5;
  if ('noIncluye' in c) return tiene(c.noIncluye) ? 0 : unaSola ? 1 : 0.5;
  return c.incluyeTodas.every((x) => marcadas.has(x)) ? 1 : unaSola ? 0 : 0.5;
}

function segundosDelPerfil(def: Definicion, f: Frente): number {
  const pide = loQuePide(def, f);
  return def.secciones.reduce((n, s) => {
    const peso = s.mostrarSi ? sale(def, s.mostrarSi, pide) : 1;
    if (!peso) return n;
    const marcadas = s.repetirPor ? pide.get(s.repetirPor) : undefined;
    const propias = marcadas instanceof Set ? [...marcadas].filter((o) => !s.repetirSolo || s.repetirSolo.includes(o)) : [];
    // Un bloque que el perfil pide sale por cada opción que pide; uno que no pide, como en lo típico.
    const instancias: { id?: string; veces: number }[] = propias.length ? propias.map((id) => ({ id, veces: 1 })) : [{ veces: veces(def, s, false) }];
    const una = (instancia?: string) => (palabras(s.titulo) + palabras(s.intro)) * SEG_POR_PALABRA + 3
      + s.preguntas.reduce((m, p) => m + segundosPregunta(def, p) * (p.mostrarSi ? sale(def, p.mostrarSi, pide, instancia) : 1), 0);
    return n + peso * instancias.reduce((m, i) => m + una(i.id) * i.veces, 0);
  }, palabras(def.bienvenida) * SEG_POR_PALABRA);
}

export interface DuracionPerfil { id: string; nombre: string; minutos: number }

/** Minutos de quien entra a cada perfil (redondeados hacia arriba), en el orden de los perfiles. */
export function duracionPorPerfil(def: Definicion): DuracionPerfil[] {
  return (def.frentes ?? []).map((f) => ({ id: f.id, nombre: f.nombre, minutos: Math.ceil(segundosDelPerfil(def, f) / 60) }));
}
