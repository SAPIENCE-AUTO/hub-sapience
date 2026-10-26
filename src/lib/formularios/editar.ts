import { citar, ubicar } from './palabras';
import { esDelInicio } from './inicio';
import {
  esDeOpciones, esMatriz, forma,
  type Condicion, type Definicion, type FilaMatriz, type Frente, type Opcion, type Pregunta, type Seccion, type TipoPregunta,
} from './tipos';

/**
 * Cambios que hace el editor a mano (fase 2 de Filtros). Funciones puras:
 * cada una recibe la definición y devuelve una nueva, sin tocar la original
 * (así el editor puede deshacer).
 *
 * Los ids nunca cambian: el de una pregunta, una opción o una fila es la
 * clave de su columna en el tablero (formularios.vinculo.columnas). Lo nuevo
 * lleva un id al azar, para que nunca reuse la clave de algo que se quitó y
 * caiga en la columna vieja.
 */

// ── ids ──────────────────────────────────────────────────────────────────────
export function idNuevo(prefijo: 'p' | 'o' | 'f' | 's' | 'fr', usados: Iterable<string>, azar: () => number = Math.random): string {
  const ya = new Set(usados);
  for (;;) {
    const id = `${prefijo}_${Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(azar() * 36)]).join('')}`;
    if (!ya.has(id)) return id;
  }
}

const idsDePreguntas = (def: Definicion) => def.secciones.flatMap((s) => s.preguntas.map((p) => p.id));
const idsDeOpciones = (p: Pregunta) => [...(p.opciones ?? []), ...(p.opcionesExtra ?? [])].map((o) => o.id);

// ── dónde se usa algo (para no quitarlo sin avisar) ──────────────────────────
interface ConDueno { c: Condicion; donde: string; pregunta?: string; seccion?: string }

/** Todas las condiciones del screener, con dónde viven. */
function condiciones(def: Definicion): ConDueno[] {
  const out: ConDueno[] = [];
  for (const s of def.secciones) {
    if (s.mostrarSi) out.push({ c: s.mostrarSi, donde: `cuándo aparece la sección «${s.titulo ?? s.id}»`, seccion: s.id });
    for (const p of s.preguntas) {
      if (p.mostrarSi) out.push({ c: p.mostrarSi, donde: `cuándo aparece ${citar(def, p.id, 40)}`, pregunta: p.id, seccion: s.id });
      if (p.terminaSi) out.push({ c: p.terminaSi.si, donde: `cuándo termina el filtro en ${citar(def, p.id, 40)}`, pregunta: p.id, seccion: s.id });
    }
  }
  for (const f of def.frentes ?? []) out.push({ c: f.califica, donde: `el perfil ${f.nombre}` });
  for (const a of def.alertas ?? []) if (a.si) out.push({ c: a.si, donde: `la alerta «${a.texto}»` });
  return out;
}

function hojas(c: Condicion): Condicion[] {
  if ('todas' in c) return c.todas.flatMap(hojas);
  if ('alguna' in c) return c.alguna.flatMap(hojas);
  if ('no' in c) return hojas(c.no);
  return [c];
}

const usaPregunta = (c: Condicion, id: string) => hojas(c).some((h) => ('pregunta' in h && h.pregunta === id) || ('numero' in h && h.numero === id));

interface Uso { texto: string; seccion?: string; pregunta?: string }

function usos(def: Definicion, id: string): Uso[] {
  const out: Uso[] = condiciones(def)
    .filter((x) => x.pregunta !== id && usaPregunta(x.c, id))
    .map((x) => ({ texto: x.donde, seccion: x.seccion, pregunta: x.pregunta }));
  for (const s of def.secciones) {
    if (s.repetirPor === id) out.push({ texto: `la sección «${s.titulo ?? s.id}» se repite por ella`, seccion: s.id });
    for (const p of s.preguntas) if (p.opcionesDe === id) out.push({ texto: `las opciones de ${citar(def, p.id, 40)} salen de ella`, seccion: s.id, pregunta: p.id });
  }
  for (const a of def.alertas ?? []) if (a.contar?.pregunta === id) out.push({ texto: `la alerta «${a.texto}»` });
  if (def.nse?.puntos[id]) out.push({ texto: 'el cálculo del NSE' });
  for (const [rol, pid] of Object.entries(def.claves ?? {})) if (pid === id) out.push({ texto: `el ${rol} que muestra el panel` });
  return out;
}

const distintos = (lista: string[]) => [...new Set(lista)];

/** Dónde se usa una pregunta fuera de ella misma, en palabras. Vacío = se puede quitar sin romper nada. */
export const usosDePregunta = (def: Definicion, id: string): string[] => distintos(usos(def, id).map((u) => u.texto));

/**
 * Dónde se usa una opción: lógica que la nombra, repeticiones que abre, reglas
 * de su matriz. También a través de las preguntas cuyas opciones salen de
 * esta («formatos que compró» sale de «formatos que usa»).
 */
export function usosDeOpcion(def: Definicion, preguntaId: string, opcionId: string): string[] {
  const lista: string[] = [];
  const derivadas = new Set([preguntaId]);
  for (let crecio = true; crecio;) {
    crecio = false;
    for (const q of def.secciones.flatMap((s) => s.preguntas)) {
      if (q.opcionesDe && derivadas.has(q.opcionesDe) && !derivadas.has(q.id)) { derivadas.add(q.id); crecio = true; }
    }
  }
  const repetidas = def.secciones.filter((s) => s.repetirPor && derivadas.has(s.repetirPor));
  for (const x of condiciones(def)) {
    const nombra = hojas(x.c).some((h) => {
      if ('pregunta' in h && derivadas.has(h.pregunta)) {
        const ids = 'incluye' in h ? h.incluye : 'noIncluye' in h ? h.noIncluye : h.incluyeTodas;
        return ids.includes(opcionId);
      }
      if ('bloque' in h) return h.opcion === opcionId && repetidas.some((s) => s.id === h.bloque);
      if ('instanciaEs' in h) return repetidas.length > 0 && h.instanciaEs.includes(opcionId);
      return 'instancia' in h && h.instancia === opcionId && repetidas.some((s) => s.preguntas.some((p) => p.id === ('pregunta' in h ? h.pregunta : h.numero)));
    });
    if (nombra) lista.push(x.donde);
  }
  for (const s of repetidas) {
    if (!s.repetirSolo || s.repetirSolo.includes(opcionId)) lista.push(`abre su bloque en la sección «${s.titulo ?? s.id}»`);
  }
  const p = ubicar(def, preguntaId)?.pregunta;
  if (p?.reglasMatriz?.some((r) => r.columnas.includes(opcionId))) lista.push('una regla de la matriz');
  if (def.nse?.puntos[preguntaId]?.[opcionId] !== undefined) lista.push('el cálculo del NSE');
  return distintos(lista);
}

/** Dónde se usa una sección desde fuera: sus preguntas o su bloque. Lo que se usa entre sus propias preguntas se va con ella. */
export function usosDeSeccion(def: Definicion, seccionId: string): string[] {
  const s = def.secciones.find((x) => x.id === seccionId);
  if (!s) return [];
  const deFuera = s.preguntas.flatMap((p) => usos(def, p.id)).filter((u) => u.seccion !== seccionId);
  const bloque = condiciones(def).filter((x) => x.seccion !== seccionId && hojas(x.c).some((h) => 'bloque' in h && h.bloque === seccionId));
  return distintos([...deFuera.map((u) => u.texto), ...bloque.map((x) => x.donde)]);
}

/** Las preguntas del NSE son las del cuestionario oficial del país: no se corrigen a mano. */
export const esDelNse = (def: Definicion, preguntaId: string) => !!def.nse?.puntos[preguntaId];
/** Preguntas que pone el Hub y no se editan: las del NSE y las de «Antes de empezar». */
export const esFija = (def: Definicion, preguntaId: string) => esDelNse(def, preguntaId) || esDelInicio(preguntaId);

// ── cambios ──────────────────────────────────────────────────────────────────
/** Quita las llaves en `undefined`, para que «quitar» un dato no deje rastro en el JSON. */
function limpio<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const enSecciones = (def: Definicion, fn: (s: Seccion) => Seccion): Definicion => ({ ...def, secciones: def.secciones.map(fn) });

function enPregunta(def: Definicion, id: string, fn: (p: Pregunta) => Pregunta): Definicion {
  return enSecciones(def, (s) => (s.preguntas.some((p) => p.id === id) ? { ...s, preguntas: s.preguntas.map((p) => (p.id === id ? fn(p) : p)) } : s));
}

function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lista.length) return lista;
  const copia = [...lista];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

export type TextosGenerales = Pick<Definicion, 'tituloPublico' | 'bienvenida' | 'despedida' | 'noCalifica'>;
export const cambiarTextos = (def: Definicion, cambio: Partial<TextosGenerales>): Definicion => ({ ...def, ...cambio });

export const cambiarSeccion = (def: Definicion, id: string, cambio: Partial<Omit<Seccion, 'id' | 'preguntas'>>): Definicion =>
  enSecciones(def, (s) => (s.id === id ? limpio({ ...s, ...cambio }) : s));

export const cambiarPregunta = (def: Definicion, id: string, cambio: Partial<Omit<Pregunta, 'id' | 'tipo'>>): Definicion =>
  enPregunta(def, id, (p) => limpio({ ...p, ...cambio }));

/** Una opción vive en `opciones` o, si las opciones salen de otra pregunta, en `opcionesExtra`. */
function enOpciones(p: Pregunta, fn: (lista: Opcion[]) => Opcion[]): Pregunta {
  return p.opcionesDe ? { ...p, opcionesExtra: fn(p.opcionesExtra ?? []) } : { ...p, opciones: fn(p.opciones ?? []) };
}

export const cambiarOpcion = (def: Definicion, preguntaId: string, opcionId: string, cambio: Partial<Omit<Opcion, 'id'>>): Definicion =>
  enPregunta(def, preguntaId, (p) => {
    const toca = (lista?: Opcion[]) => lista?.map((o) => (o.id === opcionId ? limpio({ ...o, ...cambio }) : o));
    return limpio({ ...p, opciones: toca(p.opciones), opcionesExtra: toca(p.opcionesExtra) });
  });

export function agregarOpcion(def: Definicion, preguntaId: string, label?: string): { def: Definicion; id: string } {
  const p = ubicar(def, preguntaId)?.pregunta;
  const id = idNuevo('o', p ? idsDeOpciones(p) : []);
  const lista = p ? (p.opcionesDe ? p.opcionesExtra ?? [] : p.opciones ?? []) : [];
  const nueva: Opcion = { id, label: label ?? `Opción ${lista.length + 1}` };
  // Antes de «Ninguno» y de «Otra», que suelen ir al final.
  const alFinal = lista.findIndex((o) => o.exclusiva || o.otra || o.fija);
  return {
    def: enPregunta(def, preguntaId, (q) => enOpciones(q, (l) => (alFinal < 0 ? [...l, nueva] : [...l.slice(0, alFinal), nueva, ...l.slice(alFinal)]))),
    id,
  };
}

export const quitarOpcion = (def: Definicion, preguntaId: string, opcionId: string): Definicion =>
  enPregunta(def, preguntaId, (p) => enOpciones(p, (l) => l.filter((o) => o.id !== opcionId)));

export const moverOpcion = (def: Definicion, preguntaId: string, opcionId: string, delta: number): Definicion =>
  enPregunta(def, preguntaId, (p) => enOpciones(p, (l) => mover(l, l.findIndex((o) => o.id === opcionId), delta)));

// ── filas de una matriz ──
export function agregarFila(def: Definicion, preguntaId: string): { def: Definicion; id: string } {
  const p = ubicar(def, preguntaId)?.pregunta;
  const id = idNuevo('f', (p?.filas ?? []).map((f) => f.id));
  const fila: FilaMatriz = { id, label: `Fila ${(p?.filas?.length ?? 0) + 1}` };
  return { def: enPregunta(def, preguntaId, (q) => ({ ...q, filas: [...(q.filas ?? []), fila] })), id };
}

export const cambiarFila = (def: Definicion, preguntaId: string, filaId: string, label: string): Definicion =>
  enPregunta(def, preguntaId, (p) => ({ ...p, filas: p.filas?.map((f) => (f.id === filaId ? { ...f, label } : f)) }));

export const quitarFila = (def: Definicion, preguntaId: string, filaId: string): Definicion =>
  enPregunta(def, preguntaId, (p) => limpio({
    ...p,
    filas: p.filas?.filter((f) => f.id !== filaId),
    reglasMatriz: p.reglasMatriz?.filter((r) => r.fila !== filaId),
  }));

export const moverFila = (def: Definicion, preguntaId: string, filaId: string, delta: number): Definicion =>
  enPregunta(def, preguntaId, (p) => ({ ...p, filas: mover(p.filas ?? [], (p.filas ?? []).findIndex((f) => f.id === filaId), delta) }));

// ── preguntas ──
/** Los tipos agrupados como se eligen al agregar o cambiar una pregunta en el editor. */
export const GRUPOS_TIPOS: { nombre: string; tipos: TipoPregunta[] }[] = [
  { nombre: 'De opciones', tipos: ['unica', 'multiple', 'lista', 'lista_multiple', 'imagen_unica', 'imagen_multiple', 'matriz', 'matriz_multiple', 'ordenar'] },
  { nombre: 'Se escriben', tipos: ['texto', 'texto_largo', 'numero', 'telefono', 'correo', 'direccion'] },
  { nombre: 'Escalas', tipos: ['escala', 'estrellas', 'deslizador'] },
  { nombre: 'Sí o no', tipos: ['casilla', 'interruptor'] },
  { nombre: 'Otros', tipos: ['foto', 'contenido'] },
];

const usaOpciones = (tipo: TipoPregunta) => esDeOpciones(tipo) || esMatriz(tipo) || forma(tipo) === 'orden';

function opcionesNuevas(n: number): Opcion[] {
  const ids: string[] = [];
  return Array.from({ length: n }, (_, i) => {
    const id = idNuevo('o', ids);
    ids.push(id);
    return { id, label: `Opción ${i + 1}` };
  });
}

function filasNuevas(n: number): FilaMatriz[] {
  const ids: string[] = [];
  return Array.from({ length: n }, (_, i) => {
    const id = idNuevo('f', ids);
    ids.push(id);
    return { id, label: `Fila ${i + 1}` };
  });
}

/** Una pregunta nueva de ese tipo, con lo mínimo que su tipo necesita para estar bien armada (salvo la imagen del selector). */
export function preguntaNueva(tipo: TipoPregunta, id: string): Pregunta {
  if (tipo === 'contenido') return { id, tipo, texto: 'Texto para el participante' };
  const p: Pregunta = { id, tipo, texto: 'Pregunta nueva' };
  if (usaOpciones(tipo)) p.opciones = opcionesNuevas(tipo === 'ordenar' ? 3 : 2);
  if (esMatriz(tipo)) p.filas = filasNuevas(2);
  return p;
}

export function agregarPregunta(def: Definicion, seccionId: string, tipo: TipoPregunta, indice?: number): { def: Definicion; id: string } {
  const id = idNuevo('p', idsDePreguntas(def));
  const p = preguntaNueva(tipo, id);
  return {
    def: enSecciones(def, (s) => {
      if (s.id !== seccionId) return s;
      const i = indice ?? s.preguntas.length;
      return { ...s, preguntas: [...s.preguntas.slice(0, i), p, ...s.preguntas.slice(i)] };
    }),
    id,
  };
}

/** Quita una pregunta; si era la del nombre, el celular, la edad o el género del panel, ese dato se queda sin pregunta. */
export function quitarPregunta(def: Definicion, id: string): Definicion {
  const sin = enSecciones(def, (s) => ({ ...s, preguntas: s.preguntas.filter((p) => p.id !== id) }));
  if (!def.claves || !Object.values(def.claves).includes(id)) return sin;
  return { ...sin, claves: Object.fromEntries(Object.entries(def.claves).filter(([, v]) => v !== id)) as Definicion['claves'] };
}

/**
 * Sube o baja una pregunta. En la orilla de su sección pasa a la sección de
 * al lado, pero solo si las dos se repiten igual: la clave de una respuesta
 * lleva la repetición («marcas@aerosol»), así que cruzar cambiaría su columna.
 */
export function moverPregunta(def: Definicion, id: string, delta: -1 | 1): Definicion {
  const si = def.secciones.findIndex((s) => s.preguntas.some((p) => p.id === id));
  if (si < 0) return def;
  const s = def.secciones[si];
  const pi = s.preguntas.findIndex((p) => p.id === id);
  if (pi + delta >= 0 && pi + delta < s.preguntas.length) {
    return enSecciones(def, (x) => (x.id === s.id ? { ...x, preguntas: mover(x.preguntas, pi, delta) } : x));
  }
  const vecina = def.secciones[si + delta];
  if (!vecina || vecina.repetirPor !== s.repetirPor || s.preguntas.length === 1) return def;
  const p = s.preguntas[pi];
  return enSecciones(def, (x) => {
    if (x.id === s.id) return { ...x, preguntas: x.preguntas.filter((q) => q.id !== id) };
    if (x.id === vecina.id) return { ...x, preguntas: delta < 0 ? [...x.preguntas, p] : [p, ...x.preguntas] };
    return x;
  });
}

/** ¿Se puede mover? (para apagar las flechas). */
export function sePuedeMover(def: Definicion, id: string, delta: -1 | 1): boolean {
  return moverPregunta(def, id, delta) !== def;
}

/**
 * Cambia el tipo conservando lo que el tipo nuevo puede usar: el texto, la
 * ayuda, la imagen, cuándo aparece, la nota y, si lleva opciones, sus
 * opciones (con los mismos ids). Lo que el tipo nuevo no admite se quita:
 * «Ninguno» en una de una sola respuesta, terminar por opción fuera de las
 * preguntas de opciones, el rango si cambia de número a escala, etc.
 */
export function cambiarTipo(def: Definicion, id: string, tipo: TipoPregunta): Definicion {
  return enPregunta(def, id, (p) => {
    if (p.tipo === tipo) return p;
    const f = forma(tipo);
    const nueva: Pregunta = limpio({
      id: p.id, tipo, texto: p.texto, ayuda: p.ayuda, imagen: p.imagen, mostrarSi: p.mostrarSi, nota: p.nota,
      opcional: tipo === 'contenido' ? undefined : p.opcional,
      terminaSi: p.terminaSi,
    });
    if (usaOpciones(tipo)) {
      const deOpciones = esDeOpciones(tipo);
      const ajustar = (o: Opcion): Opcion => limpio({
        ...o,
        exclusiva: f === 'varias' ? o.exclusiva : undefined,
        termina: deOpciones ? o.termina : undefined,
        descarta: deOpciones ? o.descarta : undefined,
        excluyeGrupos: deOpciones ? o.excluyeGrupos : undefined,
        otra: deOpciones ? o.otra : undefined,
      });
      if (p.opcionesDe && deOpciones) {
        nueva.opcionesDe = p.opcionesDe;
        if (p.opcionesExtra?.length) nueva.opcionesExtra = p.opcionesExtra.map(ajustar);
      } else {
        const base = p.opciones?.length ? p.opciones : [...(p.opcionesExtra ?? [])];
        nueva.opciones = (base.length ? base : opcionesNuevas(tipo === 'ordenar' ? 3 : 2)).map(ajustar);
      }
      if (p.aleatorio) nueva.aleatorio = true;
      if ((f === 'varias' || f === 'orden') && p.maxOpciones !== undefined) nueva.maxOpciones = p.maxOpciones;
    }
    if (esMatriz(tipo)) {
      nueva.filas = p.filas?.length ? p.filas : filasNuevas(2);
      if (esMatriz(p.tipo) && p.reglasMatriz) nueva.reglasMatriz = p.reglasMatriz;
    }
    if (f === 'texto' && forma(p.tipo) === 'texto' && p.patron && (tipo === 'texto' || tipo === 'texto_largo')) {
      nueva.patron = p.patron;
      if (p.patronMensaje) nueva.patronMensaje = p.patronMensaje;
    }
    // El rango pasa entre una escala y un deslizador; de un número a una escala (o a estrellas) ya no aplica.
    const escalaLibre = (t: TipoPregunta) => t === 'escala' || t === 'deslizador';
    if (escalaLibre(p.tipo) && escalaLibre(tipo)) {
      Object.assign(nueva, limpio({ min: p.min, max: p.max, paso: tipo === 'deslizador' ? p.paso : undefined, etiquetas: p.etiquetas }));
    }
    return nueva;
  });
}

// ── secciones ──
export function agregarSeccion(def: Definicion, indice: number): { def: Definicion; id: string; preguntaId: string } {
  const id = idNuevo('s', def.secciones.map((s) => s.id));
  const preguntaId = idNuevo('p', idsDePreguntas(def));
  const s: Seccion = { id, titulo: 'Sección nueva', preguntas: [preguntaNueva('unica', preguntaId)] };
  return { def: { ...def, secciones: [...def.secciones.slice(0, indice), s, ...def.secciones.slice(indice)] }, id, preguntaId };
}

export const quitarSeccion = (def: Definicion, id: string): Definicion => ({ ...def, secciones: def.secciones.filter((s) => s.id !== id) });

export const moverSeccion = (def: Definicion, id: string, delta: -1 | 1): Definicion =>
  ({ ...def, secciones: mover(def.secciones, def.secciones.findIndex((s) => s.id === id), delta) });

// ── frentes ──
export const cambiarFrente = (def: Definicion, id: string, cambio: Partial<Pick<Frente, 'nombre' | 'meta'>>): Definicion =>
  ({ ...def, frentes: def.frentes?.map((f) => (f.id === id ? { ...f, ...cambio } : f)) });

// ── «mostrar solo si» en su forma simple ──
export interface CondicionSimple { pregunta: string; incluye: string[] }

/** La condición, si es de la forma simple «marcó tal o tal en tal pregunta». Las combinadas se leen en palabras y se corrigen con la IA (fase 3). */
export function comoSimple(c?: Condicion): CondicionSimple | undefined {
  if (!c || !('pregunta' in c) || !('incluye' in c) || c.instancia) return undefined;
  return { pregunta: c.pregunta, incluye: c.incluye };
}

/**
 * Preguntas que puede usar el «mostrar solo si» de una pregunta o de una
 * sección: de opciones o de sí/no, antes que ella, y fuera de una sección que
 * se repite (salvo que sea la misma repetición: ahí la condición se lee en
 * cada bloque).
 */
export function preguntasParaCondicion(def: Definicion, lugar: { pregunta?: string; seccion: string }): Pregunta[] {
  const out: Pregunta[] = [];
  for (const s of def.secciones) {
    if (s.id === lugar.seccion && !lugar.pregunta) break;
    for (const p of s.preguntas) {
      if (p.id === lugar.pregunta) return out;
      const sirve = esDeOpciones(p.tipo) || forma(p.tipo) === 'si_no';
      if (sirve && (!s.repetirPor || s.id === lugar.seccion)) out.push(p);
    }
  }
  return out;
}

// ── comparar dos versiones ──
const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

/**
 * Qué cambia de `ahora` a `version`, en palabras, para decidir si se
 * restaura: preguntas y opciones que tiene o le faltan, textos distintos.
 * Vacío = son iguales.
 */
export function diferencias(ahora: Definicion, version: Definicion): string[] {
  const preguntas = (d: Definicion) => new Map(d.secciones.flatMap((s) => s.preguntas.map((p) => [p.id, p] as const)));
  const pa = preguntas(ahora);
  const pv = preguntas(version);
  const soloVersion = [...pv.keys()].filter((id) => !pa.has(id)).length;
  const soloAhora = [...pa.keys()].filter((id) => !pv.has(id)).length;
  let textos = 0;
  let opcionesMas = 0;
  let opcionesMenos = 0;
  let otros = 0;
  // Lo que no es texto ni qué opciones hay: tipo, lógica, orden de opciones, imágenes…
  const resto = (p: Pregunta) => JSON.stringify({
    ...p, texto: 0, ayuda: 0,
    opciones: (p.opciones ?? []).map((o) => ({ ...o, label: 0 })),
    opcionesExtra: (p.opcionesExtra ?? []).map((o) => ({ ...o, label: 0 })),
  });
  for (const [id, v] of pv) {
    const a = pa.get(id);
    if (!a) continue;
    const opsA = new Map([...(a.opciones ?? []), ...(a.opcionesExtra ?? [])].map((o) => [o.id, o]));
    const opsV = [...(v.opciones ?? []), ...(v.opcionesExtra ?? [])];
    if (a.texto !== v.texto || a.ayuda !== v.ayuda) textos++;
    let mas = 0;
    for (const o of opsV) {
      const oa = opsA.get(o.id);
      if (!oa) mas++;
      else if (oa.label !== o.label) textos++;
    }
    const menos = [...opsA.keys()].filter((oid) => !opsV.some((o) => o.id === oid)).length;
    opcionesMas += mas;
    opcionesMenos += menos;
    if (!mas && !menos && resto(a) !== resto(v)) otros++;
  }
  const generales = (['tituloPublico', 'bienvenida', 'despedida', 'noCalifica'] as const).filter((k) => ahora[k] !== version[k]).length
    + version.secciones.filter((s) => { const a = ahora.secciones.find((x) => x.id === s.id); return a && (a.titulo !== s.titulo || a.intro !== s.intro); }).length;
  const out: string[] = [];
  if (soloVersion) out.push(`Tiene ${plural(soloVersion, 'pregunta que hoy no está', 'preguntas que hoy no están')}`);
  if (soloAhora) out.push(`Le ${soloAhora === 1 ? 'falta' : 'faltan'} ${plural(soloAhora, 'pregunta de hoy', 'preguntas de hoy')}`);
  if (opcionesMas) out.push(`Tiene ${plural(opcionesMas, 'opción que hoy no está', 'opciones que hoy no están')}`);
  if (opcionesMenos) out.push(`Le ${opcionesMenos === 1 ? 'falta' : 'faltan'} ${plural(opcionesMenos, 'opción de hoy', 'opciones de hoy')}`);
  if (textos + generales) out.push(`${plural(textos + generales, 'texto distinto', 'textos distintos')}`);
  if (otros) out.push(`${plural(otros, 'pregunta con otra lógica, tipo u orden de opciones', 'preguntas con otra lógica, tipo u orden de opciones')}`);
  const orden = (d: Definicion) => d.secciones.map((s) => `${s.id}:${s.preguntas.map((p) => p.id).join(',')}`).join('|');
  if (!out.length && orden(ahora) !== orden(version)) out.push('Mismo contenido en otro orden');
  if (!out.length && JSON.stringify(ahora) !== JSON.stringify(version)) out.push('Cambios en la lógica, los perfiles o las alertas');
  return out;
}
